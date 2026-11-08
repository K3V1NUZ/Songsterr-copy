// Auto-sync analysis: aligns a score with a recording and returns sync points.
// Pure functions on Float32Arrays (runs in a Web Worker and in unit tests).
//
//   1. Offset + tempo: the recording's onset-strength curve is correlated with the
//      score's note onsets, searching tempo ratios around the user's BPM.
//   2. Drift: chroma features of score and recording are aligned with DTW in a
//      band around the step-1 line (handles live tempo drift).
//   3. Each bar start is refined against nearby onsets, then smoothed.
import type { SyncPoint } from '@/data/types';
import type { NoteEvent } from './scoreEvents';
import { beatToScoreMs, type Timeline } from './timeline';

export const ANALYSIS_RATE = 11025;

export interface AutoSyncInput {
  /** Mono PCM at ANALYSIS_RATE. */
  pcm: Float32Array;
  timeline: Timeline;
  events: NoteEvent[];
  /** BPM of the recording given by the user (0/undefined = use the score's tempo). */
  bpm?: number;
}

export interface AutoSyncResult {
  syncPoints: SyncPoint[];
  /** 0..1 */
  confidence: number;
  offsetMs: number;
  /** Recording ms per score ms (> 1 = recording is slower than written). */
  ratio: number;
  method: 'onsets' | 'onsets+dtw';
  /** Bar-start times after each stage (for diagnostics/tests). */
  stages?: Record<string, number[]>;
}

export type Progress = (fraction: number, stage: string) => void;

// ---- FFT ---------------------------------------------------------------------------------
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b]! * cr - im[b]! * ci;
        const xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr; im[b] = im[a]! - xi;
        re[a] = re[a]! + xr; im[a] = im[a]! + xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/** Magnitude spectra, frame by frame (Hann window). Calls `each(frameIndex, magnitudes)`. */
function stft(pcm: Float32Array, win: number, hop: number, each: (f: number, mag: Float32Array) => void): number {
  const frames = Math.max(0, Math.floor((pcm.length - win) / hop) + 1);
  const hann = Float32Array.from({ length: win }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win));
  const re = new Float32Array(win), im = new Float32Array(win), mag = new Float32Array(win / 2);
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < win; i++) { re[i] = pcm[off + i]! * hann[i]!; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < win / 2; k++) mag[k] = Math.hypot(re[k]!, im[k]!);
    each(f, mag);
  }
  return frames;
}

// ---- onset strength ------------------------------------------------------------------------
export const ONSET_HOP = 128;
export const ONSET_FPS = ANALYSIS_RATE / ONSET_HOP; // ≈ 86 frames per second

/** Spectral-flux onset strength, normalised to 0..1, lightly smoothed. */
export function onsetEnvelope(pcm: Float32Array): Float32Array {
  const win = 1024;
  let prev = new Float32Array(win / 2);
  const raw: number[] = [];
  stft(pcm, win, ONSET_HOP, (_f, mag) => {
    let flux = 0;
    const cur = new Float32Array(win / 2);
    for (let k = 2; k < win / 2; k++) {
      cur[k] = Math.log1p(100 * mag[k]!);
      const d = cur[k]! - prev[k]!;
      if (d > 0) flux += d;
    }
    raw.push(flux);
    prev = cur;
  });
  // subtract a moving average (~0.4 s) and half-wave rectify
  const n = raw.length, w = Math.round(0.2 * ONSET_FPS);
  const env = new Float32Array(n);
  let sum = 0;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { sum += raw[i]!; pre[i + 1] = sum; }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w), b = Math.min(n, i + w + 1);
    env[i] = Math.max(0, raw[i]! - (pre[b]! - pre[a]!) / (b - a));
  }
  const sm = smooth(env, 1.5);
  // scale so a typical strong onset is ~1 (one huge hit shouldn't flatten everything else)
  const peaks: number[] = [];
  for (let i = 1; i < n - 1; i++) if (sm[i]! > 0 && sm[i]! >= sm[i - 1]! && sm[i]! > sm[i + 1]!) peaks.push(sm[i]!);
  peaks.sort((a, b) => a - b);
  const ref = peaks.length ? peaks[Math.floor(peaks.length * 0.9)]! : 0;
  if (ref > 0) for (let i = 0; i < n; i++) sm[i] = Math.min(1, sm[i]! / ref);
  // STFT frame f is centred at f*hop + win/2: pad so that index i means time i / ONSET_FPS.
  // +2 frames (~23 ms): the flux peak lands slightly before the attack because of the
  // moving-average subtraction and smoothing (measured on synthetic recordings).
  const pad = Math.round(win / 2 / ONSET_HOP) + 2;
  const out = new Float32Array(n + pad);
  out.set(sm, pad);
  return out;
}

function smooth(x: Float32Array, sigma: number): Float32Array {
  const r = Math.ceil(sigma * 3);
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const ks = k.reduce((a, b) => a + b, 0);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    for (let j = -r; j <= r; j++) { const v = x[i + j]; if (v !== undefined) s += v * k[j + r]!; }
    out[i] = s / ks;
  }
  return out;
}

// ---- step 1: offset + tempo ratio ---------------------------------------------------------------
interface Onset { ms: number; w: number }

function scoreOnsets(tl: Timeline, events: NoteEvent[], maxMs: number): Onset[] {
  const byBeat = new Map<number, Onset>();
  for (const e of events) {
    const ms = beatToScoreMs(tl, e.beat);
    if (ms > maxMs) break;
    const key = Math.round(ms);
    const o = byBeat.get(key) ?? { ms, w: 0 };
    o.w += 1;
    byBeat.set(key, o);
  }
  // simultaneous notes count, but not linearly (a 6-note chord is not 6x one note)
  return [...byBeat.values()].map((o) => ({ ms: o.ms, w: Math.sqrt(o.w) }));
}

function correlate(env: Float32Array, onsets: Onset[], ratio: number, oMin: number, oMax: number, oStep = 1): Float32Array {
  const scores = new Float32Array(Math.floor((oMax - oMin) / oStep) + 1);
  for (const on of onsets) {
    const f = Math.round(((on.ms * ratio) / 1000) * ONSET_FPS);
    for (let i = 0, o = oMin; o <= oMax; i++, o += oStep) {
      const v = env[o + f];
      if (v !== undefined) scores[i]! += v * on.w;
    }
  }
  return scores;
}

function bestOf(env: Float32Array, onsets: Onset[], ratios: number[], oMin: number, oMax: number, oStep = 1) {
  let best = { score: -1, ratio: ratios[0]!, o: oMin };
  let all: Float32Array = new Float32Array(0);
  for (const ratio of ratios) {
    const sc = correlate(env, onsets, ratio, oMin, oMax, oStep);
    for (let i = 0; i < sc.length; i++) if (sc[i]! > best.score) { best = { score: sc[i]!, ratio, o: oMin + i * oStep }; all = sc; }
  }
  return { ...best, all };
}

/**
 * Where bar 1 starts in the recording, and the overall tempo ratio.
 *  coarse: the whole score against a heavily smoothed onset curve (repeated sections
 *          can't fool it, and the smoothing tolerates live tempo drift);
 *  fine:   the first few seconds against the sharp onset curve, near the coarse answer.
 */
export function estimateOffsetAndRatio(env: Float32Array, tl: Timeline, events: NoteEvent[], priorRatio: number) {
  const all = scoreOnsets(tl, events, Infinity);
  if (!all.length) return { offsetMs: 0, ratio: priorRatio, confidence: 0 };
  // keep the coarse search affordable on long songs: the strongest ~600 onsets
  const coarseOnsets = all.length > 600 ? [...all].sort((a, b) => b.w - a.w).slice(0, 600) : all;
  const blurred = smooth(env, 12); // ≈ 140 ms
  const oMin = -Math.round(2 * ONSET_FPS);
  const oMax = Math.max(oMin + 1, Math.min(env.length - 1, Math.round(90 * ONSET_FPS)));
  const ratios: number[] = [];
  for (let r = priorRatio * 0.94; r <= priorRatio * 1.06 + 1e-9; r += priorRatio * 0.006) ratios.push(r);
  const coarse = bestOf(blurred, coarseOnsets, ratios, oMin, oMax, 2);

  const firstMs = all[0]!.ms;
  const head = all.filter((o) => o.ms < firstMs + 12000);
  const fineRatios: number[] = [];
  for (let r = coarse.ratio - priorRatio * 0.03; r <= coarse.ratio + priorRatio * 0.03 + 1e-9; r += priorRatio * 0.002) fineRatios.push(r);
  const span = Math.round(0.4 * ONSET_FPS);
  const fine = bestOf(env, head, fineRatios, coarse.o - span, coarse.o + span);

  // confidence: how far the coarse peak stands out from the rest of the offset search
  const sc = coarse.all;
  let mean = 0;
  for (const v of sc) mean += v;
  mean /= sc.length || 1;
  let varSum = 0;
  for (const v of sc) varSum += (v - mean) ** 2;
  const sd = Math.sqrt(varSum / (sc.length || 1)) || 1;
  const z = (coarse.score - mean) / sd;
  return { offsetMs: (fine.o / ONSET_FPS) * 1000, ratio: coarse.ratio, confidence: Math.max(0, Math.min(1, (z - 2) / 4)) };
}

// ---- step 2: chroma + DTW ------------------------------------------------------------------------
const CHROMA_WIN = 4096;
const CHROMA_HOP = 1024;
const CHROMA_MS = (CHROMA_HOP / ANALYSIS_RATE) * 1000; // ≈ 93 ms

export function audioChroma(pcm: Float32Array): Float32Array[] {
  const out: Float32Array[] = [];
  const binPc: number[] = [];
  for (let k = 0; k < CHROMA_WIN / 2; k++) {
    const f = (k * ANALYSIS_RATE) / CHROMA_WIN;
    binPc.push(f < 60 || f > 2100 ? -1 : ((Math.round(12 * Math.log2(f / 440) + 69) % 12) + 12) % 12);
  }
  // frames are centred at f*hop + win/2: pad so that index j means time j * CHROMA_MS
  for (let k = 0; k < CHROMA_WIN / 2 / CHROMA_HOP; k++) out.push(new Float32Array(12));
  stft(pcm, CHROMA_WIN, CHROMA_HOP, (_f, mag) => {
    const c = new Float32Array(12);
    for (let k = 0; k < mag.length; k++) { const pc = binPc[k]!; if (pc >= 0) c[pc]! += Math.log1p(10 * mag[k]!); }
    out.push(normalize(c));
  });
  return out;
}

/** Chroma of the score, sampled every `hopMs` of *score* time. */
export function scoreChroma(tl: Timeline, events: NoteEvent[], hopMs: number): Float32Array[] {
  const frames = Math.ceil(tl.totalMs / hopMs) + 1;
  const out = Array.from({ length: frames }, () => new Float32Array(12));
  for (const e of events) {
    if (e.midi === undefined) continue;
    const a = beatToScoreMs(tl, e.beat), b = beatToScoreMs(tl, e.beat + Math.max(0.25, e.durBeats));
    for (let f = Math.floor(a / hopMs); f <= Math.min(frames - 1, Math.ceil(b / hopMs)); f++) {
      const age = Math.max(0, f * hopMs - a) / 1000;
      const w = Math.exp(-age * 1.5);
      // fundamental plus its strongest overtones (octave, fifth above)
      out[f]![e.midi % 12]! += w;
      out[f]![(e.midi + 7) % 12]! += 0.3 * w;
    }
  }
  return out.map(normalize);
}

function normalize(c: Float32Array): Float32Array {
  let s = 0;
  for (const v of c) s += v * v;
  s = Math.sqrt(s);
  if (s > 1e-9) for (let i = 0; i < c.length; i++) c[i]! /= s;
  return c;
}

/**
 * Banded DTW. Score frame i is expected near audio frame center(i); the path may
 * deviate by ±band frames. Returns, for every score frame, the matched audio frame.
 */
const LINE_PULL = 0.15;

export function bandedDtw(score: Float32Array[], audio: Float32Array[], center: (i: number) => number, band: number): { match: Float64Array; similarity: number } {
  const n = score.length, m = audio.length, W = 2 * band + 1;
  const INF = 1e18;
  const cost = new Float64Array(n * W).fill(INF);
  const from = new Int8Array(n * W); // 0 diag, 1 up (i-1), 2 left (j-1)
  const sim = (i: number, j: number) => {
    const a = score[i]!, b = audio[j]!;
    let d = 0;
    for (let k = 0; k < 12; k++) d += a[k]! * b[k]!;
    return d;
  };
  const jOf = (i: number, w: number) => Math.round(center(i)) - band + w;
  for (let i = 0; i < n; i++) {
    const c0 = Math.round(center(i)) - band;
    const cPrev = i > 0 ? Math.round(center(i - 1)) - band : 0;
    for (let w = 0; w < W; w++) {
      const j = c0 + w;
      if (j < 0 || j >= m) continue;
      // distance + a small pull towards the expected line: keeps the path from wandering
      // through silence or repeated harmony, where every alignment looks equally good
      const d = 1 - sim(i, j) + LINE_PULL * Math.abs(w - band) / band;
      let best = i === 0 && w === 0 ? 0 : INF, dir = 0;
      if (i === 0) best = w > 0 && cost[w - 1]! < INF ? cost[w - 1]! : 0;
      if (i > 0) {
        const wd = j - 1 - cPrev; // diagonal: (i-1, j-1)
        if (wd >= 0 && wd < W && cost[(i - 1) * W + wd]! < best) { best = cost[(i - 1) * W + wd]!; dir = 0; }
        const wu = j - cPrev; // up: (i-1, j)
        if (wu >= 0 && wu < W && cost[(i - 1) * W + wu]! + 0.1 < best) { best = cost[(i - 1) * W + wu]! + 0.1; dir = 1; }
      }
      if (w > 0 && cost[i * W + w - 1]! + 0.1 < best) { best = cost[i * W + w - 1]! + 0.1; dir = 2; }
      cost[i * W + w] = best + d;
      from[i * W + w] = dir;
    }
  }
  // end anywhere in the last row's band (the recording may continue after the score)
  let w = 0;
  let bestEnd = INF;
  for (let k = 0; k < W; k++) if (cost[(n - 1) * W + k]! < bestEnd) { bestEnd = cost[(n - 1) * W + k]!; w = k; }
  const match = new Float64Array(n).fill(-1);
  let i = n - 1, total = 0, count = 0;
  while (i >= 0) {
    const j = jOf(i, w);
    if (match[i] === -1) match[i] = j;
    total += sim(i, Math.max(0, Math.min(m - 1, j)));
    count++;
    const dir = from[i * W + w]!;
    if (i === 0 && w === 0) break;
    if (dir === 2 || i === 0) { w -= 1; if (w < 0) break; continue; }
    const cPrev = Math.round(center(i - 1)) - band;
    w = (dir === 0 ? j - 1 : j) - cPrev;
    i -= 1;
    if (w < 0 || w >= W) break;
  }
  for (let k = 0; k < n; k++) if (match[k] === -1) match[k] = center(k);
  return { match, similarity: count ? total / count : 0 };
}

// ---- step 2: follow the recording bar by bar ---------------------------------------------------------
interface Track { ms: number[]; strong: boolean[] }

/** Score onsets per played bar, as [score-ms offset from bar start, weight]. */
function barOnsets(tl: Timeline, events: NoteEvent[]): Array<Array<[number, number]>> {
  const out: Array<Array<[number, number]>> = tl.played.map(() => []);
  let k = 0;
  const byKey = new Map<string, [number, number]>();
  for (const e of events) {
    while (k + 1 < tl.played.length && tl.played[k + 1]!.startBeat <= e.beat + 1e-6) k++;
    const p = tl.played[k]!;
    const rel = beatToScoreMs(tl, e.beat) - p.startMs;
    const key = `${k}:${Math.round(rel)}`;
    const cur = byKey.get(key);
    if (cur) cur[1] += 1; else { const v: [number, number] = [rel, 1]; byKey.set(key, v); out[k]!.push(v); }
  }
  for (const list of out) for (const v of list) v[1] = Math.sqrt(v[1]);
  return out;
}

/**
 * Starting at played bar `from` (recording time `startMs`, `ratio` recording ms per score ms),
 * predicts each next bar and corrects it against the onset curve, two bars at a time.
 */
function trackBars(env: Float32Array, tl: Timeline, onsets: Array<Array<[number, number]>>, from: number, startMs: number, ratio: number, into?: Track): Track {
  const n = tl.played.length;
  const res: Track = into ?? { ms: new Array<number>(n).fill(0), strong: new Array<boolean>(n).fill(false) };
  let t = startMs;
  let r = ratio;
  const S = Math.round(0.15 * ONSET_FPS);
  for (let k = from; k < n; k++) {
    const p = tl.played[k]!;
    // onsets of this bar and the next, relative to this bar's start (score ms)
    const pts: Array<[number, number]> = [...onsets[k]!];
    if (k + 1 < n) for (const [rel, w] of onsets[k + 1]!) pts.push([p.durationMs + rel, w * 0.6]);
    let best = { score: -1, s: 0, q: r };
    let total = 0, count = 0;
    if (pts.length) {
      for (const qf of [0.97, 0.985, 1, 1.015, 1.03]) {
        const q = r * qf;
        for (let s = -S; s <= S; s++) {
          let sc = 0;
          for (const [rel, w] of pts) sc += (env[Math.round(((t + rel * q) / 1000) * ONSET_FPS) + s] ?? 0) * w;
          // prefer small corrections when scores are close
          sc *= 1 - 0.15 * (Math.abs(s) / S) - 0.1 * Math.abs(qf - 1) / 0.03;
          total += sc; count++;
          if (sc > best.score) best = { score: sc, s, q };
        }
      }
    }
    const wsum = pts.reduce((a, [, w]) => a + w, 0) || 1;
    // a real match stands out from the neighbouring alignments; noise doesn't
    const strong = best.score / wsum > 0.2 && best.score > 1.6 * (total / (count || 1));
    if (strong) {
      t += (best.s / ONSET_FPS) * 1000;
      r = 0.6 * r + 0.4 * best.q;
    }
    res.ms[k] = t;
    res.strong[k] = strong;
    t += p.durationMs * r;
  }
  return res;
}

export function autoSync(input: AutoSyncInput, progress: Progress = () => {}): AutoSyncResult {
  const { pcm, timeline: tl, events } = input;
  const writtenBpm = tl.played[0]?.segments[0]?.bpm ?? 120;
  const prior = input.bpm && input.bpm > 0 ? writtenBpm / input.bpm : 1;
  const stages: Record<string, number[]> = {};

  progress(0.05, 'Finding note onsets');
  const env = onsetEnvelope(pcm);
  progress(0.25, 'Finding the start and tempo');
  const step1 = estimateOffsetAndRatio(env, tl, events, prior);
  stages.step1 = tl.played.map((p) => step1.offsetMs + p.startMs * step1.ratio);

  progress(0.4, 'Following the recording');
  const onsets = barOnsets(tl, events);
  const track = trackBars(env, tl, onsets, 0, step1.offsetMs, step1.ratio);
  stages.tracked = [...track.ms];

  let method: AutoSyncResult['method'] = 'onsets';
  let dtwSim = 0;
  if (events.some((e) => e.midi !== undefined)) {
    // safety net: a harmony (chroma) alignment over the whole song. Where the bar-by-bar
    // tracking clearly disagrees with it for several bars, restart tracking from there.
    progress(0.6, 'Comparing harmony');
    const ac = audioChroma(pcm);
    const hopScore = CHROMA_MS / step1.ratio;
    const sc = scoreChroma(tl, events, hopScore);
    const lineFrame = (i: number) => (step1.offsetMs + i * hopScore * step1.ratio) / CHROMA_MS;
    progress(0.75, 'Checking for tempo changes');
    const { match, similarity } = bandedDtw(sc, ac, lineFrame, Math.round(4000 / CHROMA_MS));
    dtwSim = similarity;
    const dtwMs = tl.played.map((p) => {
      const fi = p.startMs / hopScore;
      const i0 = Math.min(match.length - 1, Math.floor(fi)), i1 = Math.min(match.length - 1, i0 + 1);
      return (match[i0]! + (match[i1]! - match[i0]!) * (fi - i0)) * CHROMA_MS;
    });
    stages.dtw = dtwMs;
    const voiced = tl.played.map((_, k) => onsets[k]!.some(() => true));
    let run = 0;
    for (let k = 0; k < tl.played.length; k++) {
      const off = voiced[k] && Math.abs(track.ms[k]! - dtwMs[k]!) > 400;
      run = off ? run + 1 : 0;
      if (run === 3) {
        const start = k - 2;
        const ratio = k + 1 < dtwMs.length ? (dtwMs[k + 1]! - dtwMs[start]!) / (tl.played[k + 1]!.startMs - tl.played[start]!.startMs) : step1.ratio;
        trackBars(env, tl, onsets, start, dtwMs[start]!, ratio > 0 ? ratio : step1.ratio, track);
        run = 0;
      }
    }
    method = 'onsets+dtw';
  }
  progress(0.95, 'Finishing');
  const barMs = track.ms;
  for (let k = 1; k < barMs.length; k++) if (barMs[k]! <= barMs[k - 1]!) barMs[k] = barMs[k - 1]! + 1;
  stages.final = [...barMs];

  const syncPoints: SyncPoint[] = tl.played.map((p, k) => ({ barIndex: p.barIndex, barOccurence: p.occurrence, barPosition: 0, millisecondOffset: Math.round(barMs[k]!) }));
  const voicedBars = tl.played.map((_, k) => onsets[k]!.length > 0);
  const nVoiced = voicedBars.filter(Boolean).length || 1;
  const hitRate = track.strong.filter((x, k) => x && voicedBars[k]).length / nVoiced;
  // Confidence is mostly "how many bars clearly matched the recording's onsets" — that
  // separates real matches from wrong audio well. Harmony agreement (DTW) adds a little.
  const dtwConf = method === 'onsets+dtw' ? Math.max(0, Math.min(1, (dtwSim - 0.45) / 0.35)) : hitRate;
  const confidence = Math.round(Math.max(0, Math.min(1, 0.8 * hitRate + 0.2 * dtwConf)) * 100) / 100;
  progress(1, 'Done');
  return { syncPoints, confidence, offsetMs: step1.offsetMs, ratio: step1.ratio, method, stages };
}
