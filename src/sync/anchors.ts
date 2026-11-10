// Plain math on the anchor array (docs/SYNC_ENGINE.md §8): building anchors, the manual edit
// operations, locked anchors, and the views the player and the lanes need. All pure.
import type { SyncPoint } from '@/data/types';
import { createSyncMap } from './syncMap';
import type { Timeline } from './timeline';
import type { Anchor, ScoreBeat } from './types';

/** Shortest a beat may become while editing (seconds). */
export const MIN_BEAT = 0.03;

export const isLocked = (a: Anchor) => a.source === 'manual';

/** Anchors for a recording that follows the score's tempo exactly (× `scale`), starting at `start` s. */
export function anchorsFromTempo(beats: ScoreBeat[], scale = 1, start = 0): Anchor[] {
  let t = start;
  return beats.map((b) => {
    const a: Anchor = { scoreBeat: b.index, time: t, source: 'auto', confidence: 0 };
    t += b.seconds / scale;
    return a;
  });
}

/**
 * Anchors from alphaTab sync points (songs synced before anchors existed). Beats that carry a sync point
 * become locked when `source` is 'manual'.
 */
export function anchorsFromSyncPoints(tl: Timeline, beats: ScoreBeat[], points: SyncPoint[], source: Anchor['source'], confidence = 1): Anchor[] {
  const map = createSyncMap(tl, points);
  const pinned = new Set(map.anchors.map((a) => Math.round(a.beat * 1000)));
  return beats.map((b) => {
    const pin = source === 'manual' && pinned.has(Math.round(b.quarter * 1000));
    return { scoreBeat: b.index, time: map.beatToMs(b.quarter) / 1000, source: pin ? 'manual' : 'auto', confidence: pin ? 1 : confidence };
  });
}

/** Sync points for the player (alphaTab): one per anchor, global offset applied. */
export function anchorsToPlayerPoints(tl: Timeline, beats: ScoreBeat[], anchors: Anchor[], globalOffset = 0): SyncPoint[] {
  const out: SyncPoint[] = [];
  for (const a of anchors) {
    const b = beats[a.scoreBeat];
    if (!b) continue;
    const p = tl.played[b.playedIndex]!;
    out.push({
      barIndex: p.barIndex,
      barOccurence: p.occurrence,
      barPosition: (b.quarter - p.startBeat) / p.quarters,
      millisecondOffset: Math.round((a.time + globalOffset) * 1000),
    });
  }
  return out;
}

function prevLock(anchors: Anchor[], i: number): number {
  for (let k = i - 1; k >= 0; k--) if (isLocked(anchors[k]!)) return k;
  return -1;
}
function nextLock(anchors: Anchor[], i: number): number {
  for (let k = i + 1; k < anchors.length; k++) if (isLocked(anchors[k]!)) return k;
  return -1;
}

/** The time range anchor i may be dragged to without crossing its locked neighbours. */
export function moveRange(anchors: Anchor[], i: number): [number, number] {
  const p = prevLock(anchors, i), n = nextLock(anchors, i);
  return [
    p >= 0 ? anchors[p]!.time + (i - p) * MIN_BEAT : -Infinity,
    n >= 0 ? anchors[n]!.time - (n - i) * MIN_BEAT : Infinity,
  ];
}

/**
 * Drag one bar line: pins anchor i at `time`. Anchors between it and the neighbouring locked anchors are
 * stretched; on a side without a locked anchor everything moves along (the tempo there stays).
 */
export function moveAnchor(anchors: Anchor[], i: number, time: number): Anchor[] {
  const cur = anchors[i];
  if (!cur) return anchors;
  const [lo, hi] = moveRange(anchors, i);
  const t = Math.min(hi, Math.max(lo, time));
  const p = prevLock(anchors, i), n = nextLock(anchors, i);
  const old = cur.time;
  return anchors.map((a, k) => {
    if (k === i) return { ...a, time: t, source: 'manual', confidence: 1 };
    if (k < i && (p < 0 || k > p)) {
      if (p < 0) return { ...a, time: a.time + (t - old) };
      const tp = anchors[p]!.time;
      return { ...a, time: tp + ((a.time - tp) * (t - tp)) / (old - tp) };
    }
    if (k > i && (n < 0 || k < n)) {
      if (n < 0) return { ...a, time: a.time + (t - old) };
      const tn = anchors[n]!.time;
      return { ...a, time: t + ((a.time - old) * (tn - t)) / (tn - old) };
    }
    return a;
  });
}

/** Shift-drag: moves anchor i and everything after it by `delta` seconds, and pins anchor i. */
export function shiftFrom(anchors: Anchor[], i: number, delta: number): Anchor[] {
  if (!anchors[i]) return anchors;
  const before = anchors[i - 1];
  const d = before ? Math.max(delta, before.time + MIN_BEAT - anchors[i]!.time) : delta;
  return anchors.map((a, k) => (k < i ? a : k === i ? { ...a, time: a.time + d, source: 'manual', confidence: 1 } : { ...a, time: a.time + d }));
}

/** Moves every anchor (locked ones too) by `delta` seconds. */
export function shiftAll(anchors: Anchor[], delta: number): Anchor[] {
  return anchors.map((a) => ({ ...a, time: a.time + delta }));
}

/** Pins the first beat of the song where it is now (for "Sync, keep start"). */
export function pinStart(anchors: Anchor[]): Anchor[] {
  return anchors.map((a, k) => (k === 0 ? { ...a, source: 'manual', confidence: 1 } : a));
}

/** Removes the pin from anchor i (its time stays). */
export function unpin(anchors: Anchor[], i: number): Anchor[] {
  return anchors.map((a, k) => (k === i && isLocked(a) ? { ...a, source: 'auto', confidence: 1 } : a));
}

/** Beats over which the correction outside the pins fades out (see fitToLocks). */
const LOCK_TAPER_BEATS = 8;

/**
 * Locked anchors survive re-analysis: the fresh auto anchors are fitted between them. Each stretch between
 * two locked anchors is stretched to meet them exactly (keeping the detected beat timing inside). Before
 * the first and after the last locked anchor, the anchors next to the pin are moved to meet it, and the
 * correction fades out over a few beats: further away, the detected beats are trusted again.
 */
export function fitToLocks(auto: Anchor[], locked: Anchor[]): Anchor[] {
  const locks = locked.filter((a) => a.scoreBeat >= 0 && a.scoreBeat < auto.length).sort((a, b) => a.scoreBeat - b.scoreBeat);
  if (!locks.length) return auto;
  const out = auto.map((a) => ({ ...a }));
  const first = locks[0]!, last = locks[locks.length - 1]!;
  const dFirst = first.time - auto[first.scoreBeat]!.time, dLast = last.time - auto[last.scoreBeat]!.time;
  const fade = (beats: number) => Math.max(0, 1 - beats / LOCK_TAPER_BEATS);
  for (let k = 0; k < first.scoreBeat; k++) out[k]!.time += dFirst * fade(first.scoreBeat - k);
  for (let k = last.scoreBeat + 1; k < out.length; k++) out[k]!.time += dLast * fade(k - last.scoreBeat);
  for (let s = 0; s + 1 < locks.length; s++) {
    const a = locks[s]!, b = locks[s + 1]!;
    const ta = auto[a.scoreBeat]!.time, tb = auto[b.scoreBeat]!.time;
    for (let k = a.scoreBeat + 1; k < b.scoreBeat; k++) {
      const f = tb > ta ? (auto[k]!.time - ta) / (tb - ta) : (k - a.scoreBeat) / (b.scoreBeat - a.scoreBeat);
      out[k]!.time = a.time + f * (b.time - a.time);
    }
  }
  for (const l of locks) out[l.scoreBeat] = { ...l };
  return out;
}

// ---- views --------------------------------------------------------------------------------------

/** Lowest anchor confidence in each played bar (index = Timeline.played index). */
export function barConfidence(tl: Timeline, beats: ScoreBeat[], anchors: Anchor[]): number[] {
  const out = tl.played.map(() => 1);
  for (const a of anchors) {
    const b = beats[a.scoreBeat];
    if (b) out[b.playedIndex] = Math.min(out[b.playedIndex]!, a.confidence);
  }
  return out;
}

/** Recording tempo of each played bar, quarter notes per minute (0 when unknown). */
export function barTempos(tl: Timeline, beats: ScoreBeat[], anchors: Anchor[]): number[] {
  const starts = new Map<number, number>();
  for (const a of anchors) { const b = beats[a.scoreBeat]; if (b?.isDownbeat) starts.set(b.playedIndex, a.time); }
  return tl.played.map((p, k) => {
    const t0 = starts.get(k);
    const t1 = starts.get(k + 1) ?? (() => {
      // the last bar: from its first to its last beat
      const own = anchors.filter((a) => beats[a.scoreBeat]?.playedIndex === k);
      if (own.length < 2) return undefined;
      const lastBeat = beats[own[own.length - 1]!.scoreBeat]!;
      return t0 !== undefined ? t0 + ((own[own.length - 1]!.time - t0) * p.quarters) / (lastBeat.quarter - p.startBeat) : undefined;
    })();
    return t0 !== undefined && t1 !== undefined && t1 > t0 ? (p.quarters * 60) / (t1 - t0) : 0;
  });
}

/**
 * Tempo labels for the tab: masterbar index -> BPM text, where the recording's tempo changes by at
 * least `minChange` (fraction) from the last label, so small wobbles don't label every bar.
 */
export function tempoLabels(tl: Timeline, beats: ScoreBeat[], anchors: Anchor[], minChange = 0.03): Map<number, string> {
  const out = new Map<number, string>();
  let last = 0;
  barTempos(tl, beats, anchors).forEach((bpm, k) => {
    if (!(bpm > 0)) return;
    if (last && Math.abs(bpm - last) / last < minChange) return;
    last = bpm;
    out.set(tl.played[k]!.barIndex, String(Math.round(bpm)));
  });
  return out;
}
