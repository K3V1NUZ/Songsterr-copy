// Loading and saving a song's sync. The anchors (SyncData) are the source of truth; the Song keeps
// the alphaTab sync points derived from them, plus the source and confidence for the library.
import { repo, syncStore } from '@/app/repo';
import type { Song, SyncSource } from '@/data/types';
import { anchorsFromSyncPoints, anchorsFromTempo, anchorsToPlayerPoints } from '@/sync/anchors';
import { scoreBeats } from '@/sync/scoreBeats';
import { ALGO_VERSION } from '@/sync/storage';
import type { Timeline } from '@/sync/timeline';
import type { Anchor, ScoreBeat, SyncData } from '@/sync/types';

/** What the sync tool edits (and undo/redo steps through). */
export interface SyncState {
  anchors: Anchor[];
  /** Seconds. */
  globalOffset: number;
}

export interface LoadedSync extends SyncState {
  beats: ScoreBeat[];
  autoAnchors?: Anchor[];
  /** The auto anchors came from an older algorithm version. */
  outdated: boolean;
}

/** The recording's tempo relative to the score's (from the BPM the user entered). */
export function tempoScale(tl: Timeline, bpm: number): number {
  const written = tl.played[0]?.segments[0]?.bpm ?? 120;
  return bpm > 0 ? bpm / written : 1;
}

/**
 * The song's sync as anchors. Saved anchors are used when they still fit the score (same number of
 * beats); otherwise they are rebuilt from the song's sync points (songs synced before anchors, or a
 * replaced score), or from the BPM when the song isn't synced yet.
 */
export async function loadSync(song: Song, tl: Timeline): Promise<LoadedSync> {
  const beats = scoreBeats(tl);
  const data = await syncStore.load(song.id).catch(() => undefined);
  if (data && data.anchors.length === beats.length) {
    const auto = data.autoAnchors?.length === beats.length ? data.autoAnchors : undefined;
    return {
      beats, anchors: data.anchors, globalOffset: data.globalOffset, ...(auto ? { autoAnchors: auto } : {}),
      outdated: data.algoVersion < ALGO_VERSION && data.anchors.some((a) => a.source === 'auto'),
    };
  }
  const anchors = song.syncPoints.length
    ? anchorsFromSyncPoints(tl, beats, song.syncPoints, song.syncSource === 'manual' ? 'manual' : 'auto', song.syncSource === 'auto' ? (song.syncConfidence ?? 1) : 1)
    : anchorsFromTempo(beats, tempoScale(tl, song.bpm));
  return { beats, anchors, globalOffset: 0, outdated: false };
}

/** Saves the sync (IndexedDB now, server when online) and the derived sync points on the song. */
export async function saveSync(
  song: Song, tl: Timeline, beats: ScoreBeat[], state: SyncState,
  opts: { source?: SyncSource; confidence?: number; autoAnchors?: Anchor[]; algoVersion?: number } = {},
): Promise<Song> {
  const edit: Pick<SyncData, 'songId' | 'anchors' | 'globalOffset'> & Partial<SyncData> = { songId: song.id, anchors: state.anchors, globalOffset: state.globalOffset };
  if (opts.autoAnchors) edit.autoAnchors = opts.autoAnchors;
  if (opts.algoVersion !== undefined) edit.algoVersion = opts.algoVersion;
  await syncStore.save(edit);
  const source = opts.source ?? (state.anchors.some((a) => a.source === 'manual') ? 'manual' : song.syncSource === 'none' ? 'manual' : song.syncSource);
  return repo.updateSong(song.id, {
    syncPoints: anchorsToPlayerPoints(tl, beats, state.anchors, state.globalOffset),
    barNumbering: 'played',
    syncSource: source,
    ...(opts.confidence !== undefined ? { syncConfidence: opts.confidence } : {}),
    syncVersion: song.syncVersion + 1,
  });
}
