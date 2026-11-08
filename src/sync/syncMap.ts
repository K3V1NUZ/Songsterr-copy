// Mapping between score position and recording time, defined by sync points.
//
// Matches alphaTab's model: between two sync points the tempo is constant in
// *beats* (the recording is linear in beats between pins); before the first
// and after the last sync point the score's own tempo curve is followed,
// scaled by the nearest segment's speed ratio.
import type { SyncPoint } from '@/data/types';
import { beatAt, beatToScoreMs, bpmAtBeat, findPlayed, playedAtBeat, type Timeline } from './timeline';

export interface Anchor {
  beat: number;
  ms: number;
}

export interface SyncMap {
  anchors: Anchor[];
  /** Absolute beat (in played order) -> recording ms. */
  beatToMs(beat: number): number;
  /** Recording ms -> absolute beat. */
  msToBeat(ms: number): number;
  /** Recording ms -> where we are in the score. */
  locate(ms: number): { playedIndex: number; barIndex: number; occurrence: number; barPosition: number; beat: number };
}

/** Sync points that point at bars not in the timeline are ignored. Non-increasing anchors are dropped. */
export function toAnchors(tl: Timeline, points: SyncPoint[]): Anchor[] {
  const raw: Anchor[] = [];
  for (const sp of points) {
    const p = findPlayed(tl, sp.barIndex, sp.barOccurence);
    if (p) raw.push({ beat: beatAt(p, sp.barPosition), ms: sp.millisecondOffset });
  }
  raw.sort((a, b) => a.beat - b.beat);
  const out: Anchor[] = [];
  for (const a of raw) {
    const last = out[out.length - 1];
    if (!last || (a.beat > last.beat && a.ms > last.ms)) out.push(a);
  }
  return out;
}

export function createSyncMap(tl: Timeline, points: SyncPoint[]): SyncMap {
  const anchors = toAnchors(tl, points);
  if (!anchors.length) anchors.push({ beat: 0, ms: 0 });
  const scoreMs = (beat: number) => beatToScoreMs(tl, beat);

  // speed ratio (recording ms per score ms) used outside the anchored range
  const ratioOf = (a: Anchor, b: Anchor) => (b.ms - a.ms) / (scoreMs(b.beat) - scoreMs(a.beat));
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  const headRatio = anchors.length > 1 ? ratioOf(first, anchors[1]!) : 1;
  const tailRatio = anchors.length > 1 ? ratioOf(anchors[anchors.length - 2]!, last) : 1;

  const beatToMs = (beat: number): number => {
    if (beat <= first.beat) return first.ms - (scoreMs(first.beat) - scoreMs(beat)) * headRatio;
    if (beat >= last.beat) return last.ms + (scoreMs(beat) - scoreMs(last.beat)) * tailRatio;
    let lo = 0;
    let hi = anchors.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (anchors[mid]!.beat <= beat) lo = mid; else hi = mid; }
    const a = anchors[lo]!;
    const b = anchors[hi]!;
    return a.ms + ((beat - a.beat) / (b.beat - a.beat)) * (b.ms - a.ms);
  };

  const msToBeat = (ms: number): number => {
    if (ms >= first.ms && ms <= last.ms && anchors.length > 1) {
      let lo = 0;
      let hi = anchors.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (anchors[mid]!.ms <= ms) lo = mid; else hi = mid; }
      const a = anchors[lo]!;
      const b = anchors[hi]!;
      return a.beat + ((ms - a.ms) / (b.ms - a.ms)) * (b.beat - a.beat);
    }
    // outside the anchors the mapping follows the score's tempo curve: invert numerically
    let lo = ms < first.ms ? -1e4 : last.beat;
    let hi = ms < first.ms ? first.beat : last.beat + 1e4;
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2;
      if (beatToMs(mid) < ms) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };

  const locate: SyncMap['locate'] = (ms) => {
    const beat = msToBeat(ms);
    const k = Math.max(0, playedAtBeat(tl, Math.max(0, beat)));
    const p = tl.played[k]!;
    const barPosition = Math.min(1, Math.max(0, (beat - p.startBeat) / p.quarters));
    return { playedIndex: k, barIndex: p.barIndex, occurrence: p.occurrence, barPosition, beat };
  };

  return { anchors, beatToMs, msToBeat, locate };
}

// ---- helpers used by the sync tools -------------------------------------------

/** Sync points for a recording that follows the score exactly, starting `offsetMs` in, at `speed` × the written tempo. */
export function syncPointsFromOffset(tl: Timeline, offsetMs: number, speed = 1, everyBars = 0): SyncPoint[] {
  const pts: SyncPoint[] = [];
  tl.played.forEach((p, k) => {
    if (k === 0 || (everyBars > 0 && k % everyBars === 0) || k === tl.played.length - 1) {
      pts.push({ barIndex: p.barIndex, barOccurence: p.occurrence, barPosition: 0, millisecondOffset: offsetMs + p.startMs / speed });
    }
  });
  return pts;
}

/**
 * Tempo of the recording implied by the sync points: the score's opening tempo scaled by the overall
 * speed between the first and last anchor. With fewer than two anchors the score's own tempo is used.
 */
export function effectiveBpm(tl: Timeline, points: SyncPoint[]): number {
  const base = bpmAtBeat(tl, 0);
  const a = toAnchors(tl, points);
  if (a.length < 2) return base;
  const f = a[0]!, l = a[a.length - 1]!;
  return (base * (beatToScoreMs(tl, l.beat) - beatToScoreMs(tl, f.beat))) / (l.ms - f.ms);
}

/**
 * Re-times the sync points for a new recording tempo: the earliest point stays where it is and every
 * other point moves closer (faster) or further away (slower). A single point gets a tempo-following
 * partner at the last bar, so the bar spacing really changes.
 */
export function retimeSyncPoints(tl: Timeline, points: SyncPoint[], bpm: number): SyncPoint[] {
  if (!(bpm > 0) || !points.length) return points;
  const withBeat = points.map((sp) => {
    const p = findPlayed(tl, sp.barIndex, sp.barOccurence);
    return { sp, beat: p ? beatAt(p, sp.barPosition) : Infinity };
  });
  const first = withBeat.reduce((a, b) => (b.beat < a.beat ? b : a));
  if (toAnchors(tl, points).length < 2) {
    if (first.beat === Infinity) return points;
    const speed = bpm / bpmAtBeat(tl, 0);
    return syncPointsFromOffset(tl, first.sp.millisecondOffset - beatToScoreMs(tl, first.beat) / speed, speed);
  }
  const factor = effectiveBpm(tl, points) / bpm;
  const t0 = first.sp.millisecondOffset;
  return points.map((p) => ({ ...p, millisecondOffset: t0 + (p.millisecondOffset - t0) * factor }));
}

/** Moves every sync point by `deltaMs` (dragging the whole bar lane). */
export function shiftSyncPoints(points: SyncPoint[], deltaMs: number): SyncPoint[] {
  return points.map((p) => ({ ...p, millisecondOffset: p.millisecondOffset + deltaMs }));
}

/**
 * Pins a bar to a recording time (dragging one barline). Replaces any point on the
 * same bar/occurrence/position and drops points that would make time run backwards.
 */
export function pinSyncPoint(tl: Timeline, points: SyncPoint[], pin: SyncPoint): SyncPoint[] {
  const key = (p: SyncPoint) => `${p.barIndex}:${p.barOccurence}:${p.barPosition}`;
  const at = findPlayed(tl, pin.barIndex, pin.barOccurence);
  if (!at) return points;
  const pinBeat = beatAt(at, pin.barPosition);
  const out = points.filter((p) => key(p) !== key(pin)).filter((p) => {
    const pp = findPlayed(tl, p.barIndex, p.barOccurence);
    if (!pp) return false;
    const b = beatAt(pp, p.barPosition);
    return b < pinBeat ? p.millisecondOffset < pin.millisecondOffset : p.millisecondOffset > pin.millisecondOffset;
  });
  out.push(pin);
  return out.sort((a, b) => a.millisecondOffset - b.millisecondOffset);
}
