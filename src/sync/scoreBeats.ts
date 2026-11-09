// Score side of the sync engine (docs/SYNC_ENGINE.md §4): the score as a flat list of beats in the order
// they are played. Repeats are already unrolled by the Timeline (alphaTab's own play order), pickup bars
// only have the beats they really have, and compound meters count dotted quarters.
import type { SyncPoint } from '@/data/types';
import type { NoteEvent } from './scoreEvents';
import type { Anchor, ScoreBeat, ScoreOnset } from './types';
import { bpmAtBeat, countPattern, type Timeline } from './timeline';

export function scoreBeats(tl: Timeline): ScoreBeat[] {
  const out: ScoreBeat[] = [];
  for (const p of tl.played) {
    const { stepQuarters } = countPattern(p.timeSignature);
    for (let i = 0; i * stepQuarters < p.quarters - 1e-9; i++) {
      const quarter = p.startBeat + i * stepQuarters;
      out.push({
        index: out.length,
        bar: p.index + 1,
        beatInBar: i + 1,
        isDownbeat: i === 0,
        expectedBpm: bpmAtBeat(tl, quarter) / stepQuarters,
        playedIndex: p.index,
        quarter,
        quarters: Math.min(stepQuarters, p.quarters - i * stepQuarters),
      });
    }
  }
  return out;
}

/** Index of the beat containing a quarter-note position (binary search). */
function beatIndexAt(beats: ScoreBeat[], quarter: number): number {
  let lo = 0, hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (beats[mid]!.quarter <= quarter + 1e-9) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Quarter-note position (Timeline beats) -> fractional score beat. */
export function quarterToScoreBeat(beats: ScoreBeat[], quarter: number): number {
  if (!beats.length) return 0;
  const j = beatIndexAt(beats, quarter);
  const b = beats[j]!;
  return j + (quarter - b.quarter) / b.quarters;
}

/** Fractional score beat -> quarter-note position. */
export function scoreBeatToQuarter(beats: ScoreBeat[], scoreBeat: number): number {
  if (!beats.length) return 0;
  const j = Math.max(0, Math.min(beats.length - 1, Math.floor(scoreBeat)));
  const b = beats[j]!;
  return b.quarter + (scoreBeat - j) * b.quarters;
}

/** The score's note onsets on the beat grid, merged per position. */
export function scoreOnsets(beats: ScoreBeat[], events: NoteEvent[]): ScoreOnset[] {
  const byPos = new Map<number, number>();
  for (const e of events) {
    const sb = Math.round(quarterToScoreBeat(beats, e.beat) * 1000) / 1000;
    byPos.set(sb, (byPos.get(sb) ?? 0) + 1);
  }
  // a 6-note chord is louder than one note, but not 6 times
  return [...byPos].map(([scoreBeat, n]) => ({ scoreBeat, weight: Math.sqrt(n) })).sort((a, b) => a.scoreBeat - b.scoreBeat);
}

/**
 * Anchors -> alphaTab sync points: one per bar start (downbeat) plus the last anchor, so the speed of
 * the last bar is known too. That's what the player and the tempo-mark lanes work with.
 */
export function anchorsToSyncPoints(tl: Timeline, beats: ScoreBeat[], anchors: Anchor[]): SyncPoint[] {
  const out: SyncPoint[] = [];
  const last = anchors[anchors.length - 1];
  for (const a of anchors) {
    const b = beats[Math.round(a.scoreBeat)];
    const onBeat = Math.abs(a.scoreBeat - Math.round(a.scoreBeat)) < 1e-9;
    if (!b || !((onBeat && b.isDownbeat) || a === last)) continue;
    const p = tl.played[b.playedIndex]!;
    const q = scoreBeatToQuarter(beats, a.scoreBeat);
    out.push({
      barIndex: p.barIndex,
      barOccurence: p.occurrence,
      barPosition: Math.min(1, Math.max(0, (q - p.startBeat) / p.quarters)),
      millisecondOffset: Math.round(a.time * 1000),
    });
  }
  return out;
}
