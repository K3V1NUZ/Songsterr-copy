// The app-wide repository. Swapped for a SupabaseRepository-backed one in phase 5.
import { LocalRepository } from '@/data/LocalRepository';
import type { SongRepository } from '@/data/SongRepository';
import type { Song } from '@/data/types';
import { remoteFromEnv, SyncStore } from '@/sync/storage';
import { detectScoreFormat, loadScore, scoreInfo } from '@/lib/scoreInfo';

export const repo: SongRepository = new LocalRepository();

/** Sync data: local first, pushed to Supabase when it is configured (sync/storage.ts). */
export const syncStore = new SyncStore(repo, remoteFromEnv(import.meta.env as Record<string, string | undefined>));

/** Stores a score file as a new song (no audio yet). Phase 4's upload flow builds on this. */
export async function addScoreFile(name: string, bytes: Uint8Array): Promise<Song> {
  const score = loadScore(bytes);
  const info = scoreInfo(score);
  const format = detectScoreFormat(name, bytes);
  const file = await repo.putFile({ kind: 'score', name, blob: new Blob([bytes as BlobPart]) });
  return repo.createSong({
    title: info.title, artist: info.artist, bpm: info.tempo, tags: [], ...(info.tuning ? { tuning: info.tuning } : {}),
    scoreFileId: file.id, scoreFormat: format, parts: info.parts, stems: [], syncPoints: [], barNumbering: 'played', syncSource: 'none',
  });
}

export const SAMPLE_SONGS = ['greensleeves.musicxml', 'demo-riff.musicxml'];

export async function addSampleSongs(): Promise<void> {
  for (const name of SAMPLE_SONGS) {
    const res = await fetch(`${import.meta.env.BASE_URL}samples/${name}`);
    await addScoreFile(name, new Uint8Array(await res.arrayBuffer()));
  }
}
