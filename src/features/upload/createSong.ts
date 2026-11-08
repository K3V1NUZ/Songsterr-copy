// Turning uploaded files into a song (used by the upload panel; unit-tested).
import type { SongRepository } from '@/data/SongRepository';
import { newId } from '@/data/SongRepository';
import type { Song, Stem } from '@/data/types';
import { detectScoreFormat, loadScore, scoreInfo, type ScoreInfo } from '@/lib/scoreInfo';

export const SCORE_ACCEPT = '.musicxml,.xml,.mxl,.gp,.gp3,.gp4,.gp5,.gpx';

export interface ScoreCheck {
  ok: boolean;
  info?: ScoreInfo;
  error?: string;
}

/** Parses a score file (MusicXML / Guitar Pro) and reports what's in it, or why it can't be read. */
export function checkScore(bytes: Uint8Array): ScoreCheck {
  try {
    const score = loadScore(bytes);
    if (!score.tracks.length || !score.masterBars.length) return { ok: false, error: 'The file has no tracks or bars.' };
    return { ok: true, info: scoreInfo(score) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface UploadInput {
  score: { name: string; bytes: Uint8Array };
  recording?: { name: string; blob: Blob };
  /** BPM of the recording (defaults to the score's tempo). */
  bpm?: number;
  title?: string;
  artist?: string;
  tags?: string[];
  /** partIndex = index into the score's parts (undefined = not linked to a part). */
  stems?: Array<{ name: string; blob: Blob; partIndex?: number }>;
}

export async function createSongFromUpload(repo: SongRepository, input: UploadInput): Promise<Song> {
  const check = checkScore(input.score.bytes);
  if (!check.ok || !check.info) throw new Error(`Could not read the score: ${check.error}`);
  const info = check.info;
  const scoreFile = await repo.putFile({ kind: 'score', name: input.score.name, blob: new Blob([input.score.bytes as BlobPart]) });
  const audio = input.recording ? await repo.putFile({ kind: 'audio', name: input.recording.name, blob: input.recording.blob }) : undefined;
  const stems: Stem[] = [];
  for (const st of input.stems ?? []) {
    const f = await repo.putFile({ kind: 'stem', name: st.name, blob: st.blob });
    const part = st.partIndex !== undefined ? info.parts[st.partIndex] : undefined;
    stems.push({ id: newId(), name: st.name.replace(/\.[^.]+$/, ''), fileId: f.id, ...(part ? { partId: part.id } : {}) });
  }
  return repo.createSong({
    title: input.title?.trim() || info.title,
    artist: input.artist?.trim() ?? info.artist,
    bpm: input.bpm && input.bpm > 0 ? input.bpm : info.tempo,
    tags: input.tags ?? [],
    ...(info.tuning ? { tuning: info.tuning } : {}),
    scoreFileId: scoreFile.id,
    scoreFormat: detectScoreFormat(input.score.name, input.score.bytes),
    ...(audio ? { audioFileId: audio.id } : {}),
    parts: info.parts,
    stems,
    syncPoints: [],
    barNumbering: 'played',
    syncSource: 'none',
  });
}

/** Replaces a song's score. Parts are rebuilt; stems stay linked by track position. */
export async function replaceScore(repo: SongRepository, song: Song, name: string, bytes: Uint8Array): Promise<Song> {
  const check = checkScore(bytes);
  if (!check.ok || !check.info) throw new Error(`Could not read the score: ${check.error}`);
  const file = await repo.putFile({ kind: 'score', name, blob: new Blob([bytes as BlobPart]) });
  const oldId = song.scoreFileId;
  const byIndex = new Map(song.parts.map((p) => [p.id, p.trackIndex] as const));
  const parts = check.info.parts;
  const stems = song.stems.map((s) => {
    const idx = s.partId ? byIndex.get(s.partId) : undefined;
    const part = idx !== undefined ? parts.find((p) => p.trackIndex === idx) : undefined;
    return { id: s.id, name: s.name, fileId: s.fileId, ...(part ? { partId: part.id } : {}) };
  });
  const next = await repo.updateSong(song.id, { scoreFileId: file.id, scoreFormat: detectScoreFormat(name, bytes), parts, stems, ...(check.info.tuning ? { tuning: check.info.tuning } : {}) });
  await repo.deleteFile(oldId);
  return next;
}

/** Replaces (or adds) the recording. Sync points no longer apply, so they are cleared. */
export async function replaceRecording(repo: SongRepository, song: Song, name: string, blob: Blob): Promise<Song> {
  const file = await repo.putFile({ kind: 'audio', name, blob });
  const old = song.audioFileId;
  const next = await repo.updateSong(song.id, { audioFileId: file.id, syncPoints: [], tempoMarks: undefined, syncSource: 'none', syncConfidence: undefined, autoSyncPoints: undefined });
  if (old) await repo.deleteFile(old);
  return next;
}

// ---- library filtering ------------------------------------------------------------------
export type LibraryFilter = 'all' | 'guitar' | 'bass' | 'drums' | 'needs-sync';

export function needsSync(song: Song): boolean {
  return !!song.audioFileId && (song.syncSource === 'none' || (song.syncSource === 'auto' && (song.syncConfidence ?? 0) < 0.6));
}

export function applyFilter(songs: Song[], filter: LibraryFilter): Song[] {
  if (filter === 'all') return songs;
  if (filter === 'needs-sync') return songs.filter(needsSync);
  return songs.filter((s) => s.parts.some((p) => p.instrument === filter));
}

export function syncLabel(song: Song): { text: string; tone: 'ok' | 'warn' | 'muted' } {
  if (!song.audioFileId) return { text: 'no recording', tone: 'muted' };
  if (song.syncSource === 'manual') return { text: 'synced', tone: 'ok' };
  if (song.syncSource === 'auto') return (song.syncConfidence ?? 0) >= 0.6 ? { text: 'synced', tone: 'ok' } : { text: 'check sync', tone: 'warn' };
  return { text: 'not synced', tone: 'warn' };
}
