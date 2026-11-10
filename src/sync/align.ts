// Alignment (docs/SYNC_ENGINE.md §6): pairs the score's beats with the detected beats.
import type { TrackedBeat } from './beatTracker';
import { FPS, onsetNear } from './onset';
import type { Anchor, ScoreBeat, ScoreOnset } from './types';

export interface AlignInput {
  beats: ScoreBeat[];
  onsets: ScoreOnset[];
  detected: TrackedBeat[];
  curve: Float32Array;
  /** Expected (refined) length of score beat j in the recording, seconds. */
  periodOf: (j: number) => number;
  /** Only detected beats in the first this-many seconds can be score beat 0. */
  searchSeconds?: number;
  /** Manual anchors: the start must agree with them. */
  locked?: Anchor[];
}

export interface AlignResult {
  /** One anchor per score beat. */
  anchors: Anchor[];
  /** Index into `detected` of score beat 0. */
  start: number;
  /** True when the best start was not clearly better (< 10 %) than the runner-up. */
  ambiguousStart: boolean;
  /** 0..1: how clearly the recording has onsets where the anchors put the score's notes. */
  noteFit: number;
}

/** Downbeat bonus for the first this-many bars (they set the bar grid). */
const START_BARS = 8;
const DOWNBEAT_BONUS = 0.5;
/** Onsets on beats where the score has a rest count against a candidate start. */
const REST_PENALTY = 0.5;
const CLEAR_MARGIN = 0.1;
/** Note fit: onsets where the notes are vs. the song's average. Noise gives about MIN, real matches GOOD and up. */
const NOTE_CONTRAST_MIN = 2;
const NOTE_CONTRAST_GOOD = 4;

/** Time of a fractional score beat when beat j is at times[j] (extrapolates past the ends). */
function timeAt(times: (j: number) => number, count: number, sb: number): number {
  const j = Math.max(0, Math.min(count - 2, Math.floor(sb)));
  const a = times(j), b = times(j + 1);
  return a + (sb - j) * (b - a);
}

/**
 * §6.1: which detected beat is score beat 0. Every candidate start is scored by how loud the recording
 * is where the score's notes would then be heard. The whole song is scored, not only the opening: in
 * a song that is played on every beat, only the end of the music tells a count-in from bar 1.
 */
export function findStart(input: AlignInput): { start: number; ambiguous: boolean } {
  const { beats, onsets, detected, curve } = input;
  const limit = input.searchSeconds ?? 20;
  if (!detected.length || !beats.length) return { start: 0, ambiguous: true };
  const win = beats.findIndex((b) => b.bar > START_BARS);
  const nWin = win < 0 ? beats.length : win;
  // beats on which no note starts
  const silent = new Set<number>(beats.map((b) => b.index));
  for (const o of onsets) silent.delete(Math.round(o.scoreBeat));
  const last = detected[detected.length - 1]!;

  const scores: number[] = [];
  for (let k = 0; k < detected.length && detected[k]!.time < limit; k++) {
    const times = (j: number) => {
      const d = detected[k + j];
      return d ? d.time : last.time + (k + j - (detected.length - 1)) * input.periodOf(Math.min(j, beats.length - 1));
    };
    const near = (t: number) => onsetNear(curve, t * FPS, 1);
    let s = 0;
    for (const o of onsets) s += o.weight * near(timeAt(times, beats.length + 1, o.scoreBeat));
    for (let j = 0; j < beats.length; j++) {
      if (j < nWin && beats[j]!.isDownbeat) s += DOWNBEAT_BONUS * near(times(j));
      if (silent.has(j)) s -= REST_PENALTY * near(times(j));
    }
    scores.push(s);
  }
  if (!scores.length) return { start: 0, ambiguous: true };
  // with a manual anchor, only starts that put that beat where the user did are allowed
  const lock = input.locked?.length ? [...input.locked].sort((a, b) => a.scoreBeat - b.scoreBeat)[0]! : undefined;
  if (lock) {
    const off = scores.map((_, k) => {
      const d = detected[k + Math.round(lock.scoreBeat)];
      const t = d ? d.time : last.time + (k + lock.scoreBeat - (detected.length - 1)) * input.periodOf(Math.round(lock.scoreBeat));
      return Math.abs(t - lock.time);
    });
    const tol = 0.5 * input.periodOf(Math.max(0, Math.min(beats.length - 1, Math.round(lock.scoreBeat))));
    let pick = -1;
    off.forEach((d, k) => { if (d < tol && (pick < 0 || scores[k]! > scores[pick]!)) pick = k; });
    if (pick < 0) pick = off.indexOf(Math.min(...off));
    return { start: pick, ambiguous: false };
  }
  let best = 0;
  for (let k = 1; k < scores.length; k++) if (scores[k]! > scores[best]!) best = k;
  let runnerUp = -Infinity;
  scores.forEach((s, k) => { if (k !== best) runnerUp = Math.max(runnerUp, s); });
  const b = scores[best]!;
  const ambiguous = !(b > 0) || (runnerUp > -Infinity && b - runnerUp < CLEAR_MARGIN * Math.abs(b));
  return { start: best, ambiguous };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

/** §6.1–6.3: one anchor per score beat. */
export function align(input: AlignInput): AlignResult {
  const { beats, detected, curve } = input;
  if (!beats.length) return { anchors: [], start: 0, ambiguousStart: true, noteFit: 0 };
  const { start, ambiguous } = findStart(input);
  const typical = median(detected.map((d) => d.strength)) || 1;
  const conf = (strength: number) => Math.max(0, Math.min(1, strength / typical));

  const anchors: Anchor[] = [];
  /** Recording seconds per expected second, for extrapolation. */
  const ratios: number[] = [];
  let d = start;
  let ref = detected[start]?.time ?? 0;
  anchors.push({ scoreBeat: 0, time: ref, source: 'auto', confidence: detected[start] ? conf(detected[start]!.strength) : 0 });

  for (let j = 1; j < beats.length; ) {
    const expected = input.periodOf(j - 1);
    const next = detected[d + 1];
    if (!next) {
      // detected beats ran out: carry on at the last local tempo
      const ratio = median(ratios.slice(-8)) || 1;
      ref += expected * ratio;
      anchors.push({ scoreBeat: j, time: ref, source: 'auto', confidence: Math.min(0.2, conf(onsetNear(curve, ref * FPS, 1))) });
      j++;
      continue;
    }
    const gap = next.time - ref;
    const r = gap / expected;
    if (r < 0.7) { d++; continue; } // an extra beat (≈ P/2): skip it
    const m = Math.round(r);
    if (m >= 2) {
      // the tracker missed a beat (≈ 2P): put one in between
      ref += gap / m;
      anchors.push({ scoreBeat: j, time: ref, source: 'auto', confidence: 0.5 * conf(onsetNear(curve, ref * FPS, 1)) });
      ratios.push(gap / m / expected);
      j++;
      continue;
    }
    ratios.push(r);
    ref = next.time;
    d++;
    anchors.push({ scoreBeat: j, time: ref, source: 'auto', confidence: conf(next.strength) });
    j++;
  }

  // how much louder the recording is where the anchors put the score's notes than anywhere in the song
  const times = (j: number) => anchors[Math.max(0, Math.min(anchors.length - 1, j))]!.time
    + (j >= anchors.length ? (j - anchors.length + 1) * input.periodOf(anchors.length - 1) : 0);
  let atNotes = 0, total = 0;
  for (const o of input.onsets) {
    total += o.weight;
    atNotes += o.weight * onsetNear(curve, timeAt(times, Math.max(2, anchors.length + 1), o.scoreBeat) * FPS, 1);
  }
  const from = Math.max(0, Math.floor(anchors[0]!.time * FPS)), to = Math.min(curve.length, Math.ceil(ref * FPS) + 1);
  let everywhere = 0;
  for (let f = from; f < to; f++) everywhere += onsetNear(curve, f, 1);
  everywhere /= Math.max(1, to - from);
  const contrast = total > 0 && everywhere > 0 ? atNotes / total / everywhere : 0;
  return { anchors, start, ambiguousStart: ambiguous, noteFit: Math.max(0, Math.min(1, (contrast - NOTE_CONTRAST_MIN) / (NOTE_CONTRAST_GOOD - NOTE_CONTRAST_MIN))) };
}
