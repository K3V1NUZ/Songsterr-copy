// Export / import a song as one zip: song.json + its files (score, audio, stems).
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { newId, type SongRepository } from './SongRepository';
import type { SyncData } from '@/sync/types';
import type { FileBlob, Id, Song } from './types';

export const BUNDLE_VERSION = 1;

interface BundleManifest {
  format: 'fretline-song';
  version: number;
  song: Song;
  files: Array<Omit<FileBlob, 'blob' | 'storagePath'> & { path: string }>;
  /** The song's anchors (optional: songs synced before anchors only have sync points). */
  sync?: Omit<SyncData, 'songId' | 'dirty' | 'updatedAt'>;
}

const safe = (name: string) => name.replace(/[^\w.() -]+/g, '_').slice(0, 100) || 'file';

export async function exportSongBundle(repo: SongRepository, songId: Id): Promise<Uint8Array> {
  const song = await repo.getSong(songId);
  if (!song) throw new Error('Song not found');
  const ids = [song.scoreFileId, song.audioFileId, ...song.stems.map((s) => s.fileId)].filter((x): x is Id => !!x);
  const entries: Zippable = {};
  const files: BundleManifest['files'] = [];
  for (const id of ids) {
    const f = await repo.getFile(id);
    if (!f?.blob) continue;
    const path = `files/${f.id}/${safe(f.name)}`;
    entries[path] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }]; // audio is already compressed
    files.push({ id: f.id, kind: f.kind, name: f.name, mime: f.mime, size: f.size, path });
  }
  const sync = await repo.getSync(songId);
  const manifest: BundleManifest = { format: 'fretline-song', version: BUNDLE_VERSION, song, files };
  if (sync) {
    const { songId: _id, dirty: _dirty, updatedAt: _at, ...rest } = sync;
    manifest.sync = rest;
  }
  entries['song.json'] = strToU8(JSON.stringify(manifest, null, 2));
  return zipSync(entries);
}

/** Imports a bundle as a new song (fresh ids, so importing twice gives two songs). */
export async function importSongBundle(repo: SongRepository, data: Uint8Array): Promise<Song> {
  const entries = unzipSync(data);
  const raw = entries['song.json'];
  if (!raw) throw new Error('Not a Fretline song bundle (song.json missing)');
  const manifest = JSON.parse(strFromU8(raw)) as BundleManifest;
  if (manifest.format !== 'fretline-song') throw new Error('Not a Fretline song bundle');
  if (manifest.version > BUNDLE_VERSION) throw new Error('This bundle was made by a newer version of the app');

  const idMap = new Map<Id, Id>();
  for (const f of manifest.files) {
    const bytes = entries[f.path];
    if (!bytes) throw new Error(`Bundle is missing ${f.path}`);
    const stored = await repo.putFile({ kind: f.kind, name: f.name, mime: f.mime, blob: new Blob([bytes as BlobPart], { type: f.mime }) });
    idMap.set(f.id, stored.id);
  }
  const map = (id: Id | undefined) => (id ? idMap.get(id) : undefined);
  const s = manifest.song;
  const scoreFileId = map(s.scoreFileId);
  if (!scoreFileId) throw new Error('Bundle has no score file');
  const audioFileId = map(s.audioFileId);
  const partIds = new Map(s.parts.map((p) => [p.id, newId()] as const));
  const created = await repo.createSong({
    title: s.title, artist: s.artist, bpm: s.bpm, tags: s.tags, tuning: s.tuning, difficulty: s.difficulty,
    scoreFileId, scoreFormat: s.scoreFormat, ...(audioFileId ? { audioFileId } : {}), durationMs: s.durationMs,
    parts: s.parts.map((p) => ({ ...p, id: partIds.get(p.id) ?? newId() })),
    stems: s.stems.flatMap((st) => {
      const fileId = map(st.fileId);
      if (!fileId) return [];
      const partId = st.partId ? partIds.get(st.partId) : undefined;
      return [{ id: newId(), name: st.name, fileId, ...(partId ? { partId } : {}) }];
    }),
    syncPoints: s.syncPoints, syncSource: s.syncSource, syncConfidence: s.syncConfidence,
    ...(s.barNumbering ? { barNumbering: s.barNumbering } : {}),
  });
  if (manifest.sync) await repo.putSync({ ...manifest.sync, songId: created.id, updatedAt: Date.now(), dirty: true });
  return created;
}
