// Onset strength curve (spectral flux), see docs/SYNC_ENGINE.md §5.2.
// High wherever something new starts (a drum hit, a picked chord), low during sustained sound.
import { fft } from './fft';

export const SAMPLE_RATE = 22050;
export const FRAME_SIZE = 1024;
export const HOP_SIZE = 256;
/** Frames per second of the onset curve (≈ 86). */
export const FPS = SAMPLE_RATE / HOP_SIZE;

/**
 * Index i of the curve means time i / FPS. A frame's flux is reported at the frame centre plus one frame,
 * a correction measured on click tracks: with a Hann window, the flux (and the parabola fitted through it)
 * peaks slightly before the attack reaches the frame centre.
 */
const LATENCY_FRAMES = FRAME_SIZE / 2 / HOP_SIZE + 1;

export function onsetCurve(samples: Float32Array, onProgress?: (pct: number) => void): Float32Array {
  const frames = Math.max(0, Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1);
  const bins = FRAME_SIZE / 2;
  const hann = new Float32Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME_SIZE);
  const re = new Float32Array(FRAME_SIZE), im = new Float32Array(FRAME_SIZE);
  let prev = new Float32Array(bins), cur = new Float32Array(bins);
  const flux = new Float32Array(frames);

  for (let f = 0; f < frames; f++) {
    const off = f * HOP_SIZE;
    for (let i = 0; i < FRAME_SIZE; i++) { re[i] = samples[off + i]! * hann[i]!; im[i] = 0; }
    fft(re, im);
    let sum = 0;
    for (let k = 1; k < bins; k++) {
      // log compression: stops loud bass notes from drowning out the hi-hats
      cur[k] = Math.log1p(100 * Math.sqrt(re[k]! * re[k]! + im[k]! * im[k]!));
      // only increases count: notes starting matter, notes fading don't
      if (f > 0) { const d = cur[k]! - prev[k]!; if (d > 0) sum += d; }
    }
    flux[f] = sum;
    const t = prev; prev = cur; cur = t;
    if (onProgress && (f & 1023) === 0) onProgress(f / frames);
  }

  // remove slow loudness changes: subtract a ~0.5 s moving average, clip negatives
  const n = frames, w = Math.round((0.5 * FPS) / 2);
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i]! + flux[i]!;
  const out = new Float32Array(n + LATENCY_FRAMES);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w), b = Math.min(n, i + w + 1);
    out[i + LATENCY_FRAMES] = Math.max(0, flux[i]! - (pre[b]! - pre[a]!) / (b - a));
  }
  // standard deviation 1: keeps the beat tracker's tightness meaningful for quiet and loud songs
  let mean = 0;
  for (const v of out) mean += v;
  mean /= out.length || 1;
  let varSum = 0;
  for (const v of out) varSum += (v - mean) ** 2;
  const sd = Math.sqrt(varSum / (out.length || 1));
  if (sd > 1e-9) for (let i = 0; i < out.length; i++) out[i]! /= sd;
  onProgress?.(1);
  return out;
}

/** Onset value at a fractional frame position (linear interpolation, 0 outside the curve). */
export function onsetAt(curve: Float32Array, frame: number): number {
  const i = Math.floor(frame), t = frame - i;
  return (curve[i] ?? 0) * (1 - t) + (curve[i + 1] ?? 0) * t;
}

/** Largest onset value within ±radius frames of a position (tolerates small timing errors). */
export function onsetNear(curve: Float32Array, frame: number, radius = 2): number {
  const c = Math.round(frame);
  let m = 0;
  for (let i = c - radius; i <= c + radius; i++) m = Math.max(m, curve[i] ?? 0);
  return m;
}
