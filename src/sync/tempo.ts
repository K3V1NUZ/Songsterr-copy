// Tempo refinement (docs/SYNC_ENGINE.md §5.3). The score or the user gives the tempo; the audio only
// refines it (120 written, 118.5 played) and warns when the band feels the beat twice as fast or slow.
import { FPS, onsetAt } from './onset';
import type { ScoreBeat, SyncWarning } from './types';

/** A stretch of beats with one written tempo. */
export interface TempoSection {
  /** First score beat of the section. */
  startBeat: number;
  /** One past the last score beat. */
  endBeat: number;
  /** Expected tempo in beats per minute (hint, then refined). */
  bpm: number;
}

/** Search range around the hint (±8 %). */
const RANGE = 0.08;
/** A tempo level counts as "clearly stronger" when its autocorrelation is this much higher. */
const LEVEL_RATIO = 1.5;
/** Sections shorter than this keep the hinted tempo: too little audio to measure it. */
const MIN_SECTION_BEATS = 8;

/** Groups beats into sections of equal written tempo. `scale` = recording tempo / written tempo. */
export function tempoSections(beats: ScoreBeat[], scale = 1): TempoSection[] {
  const out: TempoSection[] = [];
  for (const b of beats) {
    const bpm = b.expectedBpm * scale;
    const last = out[out.length - 1];
    if (last && Math.abs(last.bpm - bpm) < 1e-6) last.endBeat = b.index + 1;
    else out.push({ startBeat: b.index, endBeat: b.index + 1, bpm });
  }
  return out;
}

/** Autocorrelation of the curve at a (fractional) lag, over frames [from, to). */
export function autocorrelation(curve: Float32Array, lag: number, from = 0, to = curve.length): number {
  const end = Math.min(to, curve.length) - lag;
  let s = 0, n = 0;
  for (let i = Math.max(0, from); i < end; i++) { s += curve[i]! * onsetAt(curve, i + lag); n++; }
  return n > 0 ? s / n : 0;
}

/** Highest autocorrelation for lags within ±range of `lag`, and the lag where it is. */
function bestLag(curve: Float32Array, lag: number, from: number, to: number, range: number, comb: boolean) {
  let best = { lag, value: -Infinity };
  const step = 0.05;
  for (let l = lag * (1 - range); l <= lag * (1 + range) + 1e-9; l += step) {
    // the comb (lag, 2·lag, 3·lag, 4·lag) gives a sharper peak, i.e. a more precise period
    let v = 0;
    if (comb) for (let m = 1; m <= 4; m++) v += autocorrelation(curve, l * m, from, to) / m;
    else v = autocorrelation(curve, l, from, to);
    if (v > best.value) best = { lag: l, value: v };
  }
  return best;
}

export interface TempoEstimate {
  /** Refined tempo in beats per minute. */
  bpm: number;
  warning?: SyncWarning;
}

/** Refines a tempo hint on frames [from, to) of the onset curve and checks for double/half tempo. */
export function refineTempo(curve: Float32Array, hintBpm: number, from = 0, to = curve.length): TempoEstimate {
  const P = (60 * FPS) / hintBpm;
  if (to - from < 4 * P) return { bpm: hintBpm };
  const best = bestLag(curve, P, from, to, RANGE, true);
  const bpm = (60 * FPS) / best.lag;
  // compare the plain autocorrelation at the beat level with half and double the period
  const base = bestLag(curve, best.lag, from, to, 0.03, false).value;
  const half = bestLag(curve, best.lag / 2, from, to, 0.05, false).value;
  const double = bestLag(curve, best.lag * 2, from, to, 0.05, false).value;
  let warning: SyncWarning | undefined;
  if (base > 0 && half > LEVEL_RATIO * base) {
    warning = { code: 'TEMPO_DOUBLE', detail: `Detected ~${Math.round(bpm * 2)} BPM, did you mean ${Math.round(bpm)}?` };
  } else if (base > 0 && double > LEVEL_RATIO * base) {
    warning = { code: 'TEMPO_HALF', detail: `Detected ~${Math.round(bpm / 2)} BPM, did you mean ${Math.round(bpm)}?` };
  }
  // the score is the source of truth for counting: stay at the score's tempo level either way
  return { bpm, ...(warning ? { warning } : {}) };
}

/**
 * Refines every tempo section. Sections are placed on the audio by the score's ideal timeline starting
 * at `startFrame` (a rough guess; the alignment doesn't exist yet).
 */
export function refineSections(curve: Float32Array, sections: TempoSection[], startFrame: number): { sections: TempoSection[]; warnings: SyncWarning[] } {
  const warnings: SyncWarning[] = [];
  const out: TempoSection[] = [];
  let frame = startFrame;
  for (const s of sections) {
    const beats = s.endBeat - s.startBeat;
    const len = (beats * 60 * FPS) / s.bpm;
    if (beats < MIN_SECTION_BEATS) { out.push({ ...s }); frame += len; continue; }
    // a single section covers the whole song (count-ins and outros included)
    const from = sections.length === 1 ? 0 : Math.round(frame);
    const to = sections.length === 1 ? curve.length : Math.round(frame + len);
    const est = refineTempo(curve, s.bpm, from, to);
    if (est.warning && !warnings.some((w) => w.code === est.warning!.code)) warnings.push(est.warning);
    out.push({ ...s, bpm: est.bpm });
    frame += (beats * 60 * FPS) / est.bpm;
  }
  return { sections: out, warnings };
}

/** Expected beat period in frames for every frame of the curve: P(t) for the beat tracker. */
export function periodCurve(sections: TempoSection[], startFrame: number, frames: number): Float32Array {
  const out = new Float32Array(frames);
  if (!sections.length) return out.fill((60 * FPS) / 120);
  let frame = startFrame, k = 0;
  let end = frame + ((sections[0]!.endBeat - sections[0]!.startBeat) * 60 * FPS) / sections[0]!.bpm;
  for (let t = 0; t < frames; t++) {
    while (t >= end && k + 1 < sections.length) {
      k++;
      frame = end;
      end = frame + ((sections[k]!.endBeat - sections[k]!.startBeat) * 60 * FPS) / sections[k]!.bpm;
    }
    out[t] = (60 * FPS) / sections[k]!.bpm;
  }
  return out;
}
