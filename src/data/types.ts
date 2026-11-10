// Core domain types. Storage-agnostic: used by LocalRepository (Dexie) now and
// SupabaseRepository later.

export type Id = string;

/** Same shape as alphaTab's FlatSyncPoint, so it can be passed straight to `score.applyFlatSyncPoints`. */
export interface SyncPoint {
  /** Index of the bar in the score (masterbar index, 0-based). */
  barIndex: number;
  /** Which time this bar is played, for bars inside repeats (0 = first time). */
  barOccurence: number;
  /** Position inside the bar, 0..1. */
  barPosition: number;
  /** Time in the recording, in milliseconds. */
  millisecondOffset: number;
}

export type ScoreFormat = 'musicxml' | 'mxl' | 'gp3' | 'gp4' | 'gp5' | 'gpx' | 'gp';
export type FileKind = 'score' | 'audio' | 'stem';
export type SyncSource = 'none' | 'auto' | 'manual';

export interface FileBlob {
  id: Id;
  kind: FileKind;
  name: string;
  mime: string;
  size: number;
  /** Present for locally stored files. */
  blob?: Blob;
  /** Present for cloud-stored files (phase 5). */
  storagePath?: string;
}

/** A player/instrument in the score (one alphaTab track). */
export interface Part {
  id: Id;
  name: string;
  instrument: string;
  /** Index of the track in the score. */
  trackIndex: number;
  tuning?: string;
}

/** An audio stem (backing track). Usually belongs to one part, but doesn't have to (e.g. "band minus guitar"). */
export interface Stem {
  id: Id;
  name: string;
  fileId: Id;
  partId?: Id;
}

export interface Song {
  id: Id;
  title: string;
  artist: string;
  /** BPM of the recording, entered by the user (prior for auto-sync). */
  bpm: number;
  tags: string[];
  tuning?: string;
  difficulty?: number;
  createdAt: number;
  updatedAt: number;
  scoreFileId: Id;
  scoreFormat: ScoreFormat;
  audioFileId?: Id;
  durationMs?: number;
  parts: Part[];
  stems: Stem[];
  /**
   * For the player (alphaTab), derived from the song's anchors (sync/types.ts SyncData, stored apart and
   * pushed to the server) — one per score beat, global offset applied.
   */
  syncPoints: SyncPoint[];
  /**
   * 'played': sync points count bars in play order (repeats written out, see
   * sync/unroll.ts). Missing on songs saved before that; their sync data is moved over once.
   */
  barNumbering?: 'played';
  syncSource: SyncSource;
  /** 0..1, how sure auto-sync was. */
  syncConfidence?: number;
  /** Increases on every sync-point change (used for conflict handling when shared). */
  syncVersion: number;
  ownerId?: Id;
  bandId?: Id;
}

/** Per-user, per-song preferences. Kept separate so they never leak into shared band data. */
export interface SongSettings {
  songId: Id;
  trackIndex: number;
  /** Volume 0..1 per channel: 'main', 'metronome', 'synth', or a stem id. */
  volumes: Record<string, number>;
  muted: string[];
  solo: string[];
  speed: number;
  zoom: number;
  view: 'tab' | 'tab+score' | 'score';
  lastPositionMs?: number;
}

export type NewSong = Omit<Song, 'id' | 'createdAt' | 'updatedAt' | 'syncVersion'> & { id?: Id };

export interface SongQuery {
  text?: string;
  sort?: 'recent' | 'title' | 'artist';
}
