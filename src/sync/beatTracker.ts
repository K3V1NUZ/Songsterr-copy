// Dynamic-programming beat tracker after Ellis (2007), see docs/SYNC_ENGINE.md §5.4.
//
//   C(t) = O(t) + max over τ in [t − 2P, t − P/2] of ( C(τ) − α · log((t − τ) / P)² )
//
// It finds the chain of beats that lands on onsets *and* keeps a steady pulse, over the whole song at
// once, so it plays through bars where the drummer stops.
import { FPS } from './onset';

export interface TrackedBeat {
  /** Seconds. */
  time: number;
  /** Frame of the beat (integer, before sub-frame refinement). */
  frame: number;
  /** Onset strength at the beat. */
  strength: number;
}

export interface BeatTrackerOptions {
  /** How strongly a steady tempo is enforced. 100 for studio songs, 30–60 for loose live recordings. */
  tightness?: number;
}

/**
 * @param onset  onset strength curve (FPS frames per second)
 * @param period expected beat period in frames, per frame (P(t)); a number for a constant tempo
 */
export function trackBeats(onset: Float32Array, period: Float32Array | number, opts: BeatTrackerOptions = {}): TrackedBeat[] {
  const n = onset.length;
  if (!n) return [];
  const alpha = opts.tightness ?? 100;
  const P = (t: number) => (typeof period === 'number' ? period : period[Math.min(period.length - 1, t)]!);
  const C = new Float64Array(n);
  const prev = new Int32Array(n).fill(-1);

  for (let t = 0; t < n; t++) {
    const p = P(t);
    const lo = Math.round(t - 2 * p), hi = Math.round(t - p / 2);
    let best = -Infinity, arg = -1;
    for (let tau = Math.max(0, lo); tau <= hi; tau++) {
      const r = Math.log((t - tau) / p);
      const v = C[tau]! - alpha * r * r;
      if (v > best) { best = v; arg = tau; }
    }
    // near the start there may be no full predecessor window: a chain can begin here
    if (arg < 0 || (lo < 0 && best < 0)) { C[t] = onset[t]!; prev[t] = -1; }
    else { C[t] = onset[t]! + best; prev[t] = arg; }
  }

  // the final beat: the best score within the last period of the song
  const lastP = P(n - 1);
  let end = n - 1;
  for (let t = Math.max(0, Math.round(n - lastP)); t < n; t++) if (C[t]! > C[end]!) end = t;

  const frames: number[] = [];
  for (let t = end; t >= 0; t = prev[t]!) frames.push(t);
  frames.reverse();
  return frames.map((f) => ({ time: refineFrame(onset, f) / FPS, frame: f, strength: onset[f]! }));
}

/** Sub-frame refinement: the peak of a parabola through the onset values at f−1, f, f+1. */
export function refineFrame(onset: Float32Array, f: number): number {
  const a = onset[f - 1], b = onset[f], c = onset[f + 1];
  if (a === undefined || b === undefined || c === undefined) return f;
  const den = a - 2 * b + c;
  if (den >= 0 || b < a || b < c) return f; // not a peak
  const d = (0.5 * (a - c)) / den;
  return f + Math.max(-0.5, Math.min(0.5, d));
}

/** Local tempo at each beat (beats per minute): 60 / median of the next 8 gaps. */
export function localBpm(times: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < times.length; i++) {
    const a = Math.max(0, Math.min(i, times.length - 9));
    const gaps: number[] = [];
    for (let k = a; k < Math.min(times.length - 1, a + 8); k++) gaps.push(times[k + 1]! - times[k]!);
    if (!gaps.length) { out.push(out[out.length - 1] ?? 0); continue; }
    gaps.sort((x, y) => x - y);
    const med = gaps[gaps.length >> 1]!;
    out.push(med > 0 ? 60 / med : 0);
  }
  return out;
}
