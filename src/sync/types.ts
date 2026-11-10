// Shared data shapes of the sync engine (see docs/SYNC_ENGINE.md §3).

/** One point where the score and the audio are pinned together. */
export interface Anchor {
  /** Absolute beat index in playback order (0 = first beat of bar 1). Fractions = inside a beat. */
  scoreBeat: number;
  /** Seconds in the audio file. */
  time: number;
  source: 'auto' | 'manual';
  /** 0..1, how sure the detector is (manual = 1). */
  confidence: number;
}

/** One beat of the score, after repeats are unrolled. */
export interface ScoreBeat {
  /** = Anchor.scoreBeat */
  index: number;
  /** 1-based bar number in play order (the app numbers bars as they are heard). */
  bar: number;
  /** 1-based. */
  beatInBar: number;
  isDownbeat: boolean;
  /** Tempo written in the score at this beat, in *beats* per minute (a 6/8 beat is a dotted quarter). */
  expectedBpm: number;
  /** Index into Timeline.played (links the beat back to alphaTab's bars). */
  playedIndex: number;
  /** Absolute position in quarter notes (Timeline beat units). */
  quarter: number;
  /** Length of this beat in quarter notes (1.5 in 6/8, shorter for a cut-off last beat of a pickup). */
  quarters: number;
  /** Length of this beat in seconds at the written tempo. */
  seconds: number;
}

/** A note onset of the score, placed on the beat grid. */
export interface ScoreOnset {
  /** Fractional score beat (2.5 = an eighth note after beat 2 in 4/4). */
  scoreBeat: number;
  /** How much it should be heard (simultaneous notes count, but not linearly). */
  weight: number;
}

export type SyncWarningCode = 'TEMPO_DOUBLE' | 'TEMPO_HALF' | 'LOW_CONFIDENCE_START';

export interface SyncWarning {
  code: SyncWarningCode;
  detail: string;
}

/** The saved sync of one song (docs/SYNC_ENGINE.md §3, §10). */
export interface SyncData {
  songId: string;
  /** One per score beat, always sorted by scoreBeat. */
  anchors: Anchor[];
  /** Seconds, added to every anchor (fixes MP3 decoder delay or a consistently early/late feel). */
  globalOffset: number;
  /** Version of the auto-sync algorithm that produced the auto anchors. */
  algoVersion: number;
  /** ms timestamp, used for "newest edit wins". */
  updatedAt: number;
  /** true = not pushed to the server yet. */
  dirty: boolean;
  /** The last auto-sync result, so manual edits can be reset to it. Local only. */
  autoAnchors?: Anchor[];
}
