// Mapping between score position and recording time, defined by sync points.
//
// Matches alphaTab's model: between two sync points the tempo is constant in
// *beats* (the recording is linear in beats between pins); before the first
// and after the last sync point the score's own tempo curve is followed,
// scaled by the nearest segment's speed ratio.
import type { SyncPoint } from '@/data/types';
import { beatAt, beatToScoreMs, findPlayed, playedAtBeat, type Timeline } from './timeline';

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
