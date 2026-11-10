// Score position <-> seconds in the recording (docs/SYNC_ENGINE.md §7).
// Binary search for the two surrounding anchors, then linear interpolation. Before the first and after
// the last anchor, the tempo of the nearest pair carries on. The global offset is added at the end.
import type { Anchor } from './types';

export interface TimeMap {
  /** Where is this score position in the audio? (seconds) */
  secondsAt(scoreBeat: number): number;
  /** Which score position is playing at this time? */
  scoreBeatAt(seconds: number): number;
}

const DEFAULT_BEAT = 0.5; // 120 BPM when there is only one anchor

export function createTimeMap(anchors: Pick<Anchor, 'scoreBeat' | 'time'>[], globalOffset = 0): TimeMap {
  const a = anchors;
  const n = a.length;
  const slope = (i: number, j: number) => (a[j]!.time - a[i]!.time) / (a[j]!.scoreBeat - a[i]!.scoreBeat);

  const secondsAt = (beat: number): number => {
    if (!n) return beat * DEFAULT_BEAT + globalOffset;
    if (n === 1) return a[0]!.time + (beat - a[0]!.scoreBeat) * DEFAULT_BEAT + globalOffset;
    if (beat <= a[0]!.scoreBeat) return a[0]!.time + (beat - a[0]!.scoreBeat) * slope(0, 1) + globalOffset;
    if (beat >= a[n - 1]!.scoreBeat) return a[n - 1]!.time + (beat - a[n - 1]!.scoreBeat) * slope(n - 2, n - 1) + globalOffset;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (a[mid]!.scoreBeat <= beat) lo = mid; else hi = mid; }
    return a[lo]!.time + (beat - a[lo]!.scoreBeat) * slope(lo, hi) + globalOffset;
  };

  const scoreBeatAt = (seconds: number): number => {
    const t = seconds - globalOffset;
    if (!n) return t / DEFAULT_BEAT;
    if (n === 1) return a[0]!.scoreBeat + (t - a[0]!.time) / DEFAULT_BEAT;
    if (t <= a[0]!.time) return a[0]!.scoreBeat + (t - a[0]!.time) / slope(0, 1);
    if (t >= a[n - 1]!.time) return a[n - 1]!.scoreBeat + (t - a[n - 1]!.time) / slope(n - 2, n - 1);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (a[mid]!.time <= t) lo = mid; else hi = mid; }
    return a[lo]!.scoreBeat + (t - a[lo]!.time) / slope(lo, hi);
  };

  return { secondsAt, scoreBeatAt };
}
