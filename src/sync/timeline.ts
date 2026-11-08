// Score timing: which bars are played in which order (repeats, alternate
// endings), and where each played bar sits in "score time" (beats and ms at
// the score's own tempo). Pure functions — no alphaTab or DOM dependency.

export const TICKS_PER_QUARTER = 960;

export interface TempoChange {
  /** Position inside the bar, 0..1. */
  position: number;
  /** Quarter notes per minute. */
  bpm: number;
}

export interface BarTiming {
  /** Bar length in quarter notes. */
  quarters: number;
  /** Tempo changes inside this bar (position 0 = at the bar start). */
  tempoChanges: TempoChange[];
  isRepeatStart: boolean;
  /** Total number of plays when this bar ends a repeat (0 = not a repeat end). */
  repeatCount: number;
  /** Bitmask of alternate endings this bar belongs to (bit 0 = ending 1). 0 = not an ending. */
  alternateEndings: number;
  /** [numerator, denominator]; defaults to 4/4 when missing. */
  timeSignature?: [number, number];
}

export interface ScoreTiming {
  /** Tempo at the very start of the score. */
  initialBpm: number;
  bars: BarTiming[];
}

export interface PlayedBar {
  /** Index in the played sequence. */
  index: number;
  barIndex: number;
  /** How many times this bar was played before (0 = first time). */
  occurrence: number;
  /** Cumulative quarter notes at the start of this played bar. */
  startBeat: number;
  quarters: number;
  /** Score time (at the written tempo) of the bar start, in ms. */
  startMs: number;
  durationMs: number;
  /** Tempo segments inside the bar: [{beat offset from bar start, bpm}] — always starts at 0. */
  segments: Array<{ beat: number; bpm: number }>;
  timeSignature: [number, number];
}

export interface Timeline {
  played: PlayedBar[];
  totalBeats: number;
  totalMs: number;
}

/** Expands repeats and alternate endings into the order bars are played. */
export function playOrder(bars: Pick<BarTiming, 'isRepeatStart' | 'repeatCount' | 'alternateEndings'>[]): number[] {
  const order: number[] = [];
  let start = 0;
  let pass = 1;
  let inEndings = false;
  let i = 0;
  let guard = 0;
  while (i < bars.length && guard++ < 100000) {
    const b = bars[i]!;
    if (b.isRepeatStart && i !== start) { start = i; pass = 1; }
    if (b.alternateEndings) {
      inEndings = true;
      if (!(b.alternateEndings & (1 << (pass - 1)))) { i++; continue; }
    } else if (inEndings) { inEndings = false; pass = 1; start = i; }
    order.push(i);
    if (b.repeatCount > 0) {
      if (pass < b.repeatCount) { pass++; i = start; inEndings = false; continue; }
      pass = 1; start = i + 1; inEndings = false;
    }
    i++;
  }
  return order;
}

export function buildTimeline(timing: ScoreTiming): Timeline {
  const order = playOrder(timing.bars);
  const seen = new Map<number, number>();
  const played: PlayedBar[] = [];
  // tempo is sticky: it carries over from the previously *played* bar
  let bpm = timing.initialBpm;
  let beat = 0;
  let ms = 0;
  order.forEach((barIndex, index) => {
    const bar = timing.bars[barIndex]!;
    const occurrence = seen.get(barIndex) ?? 0;
    seen.set(barIndex, occurrence + 1);
    const segments: PlayedBar['segments'] = [];
    const changes = [...bar.tempoChanges].sort((a, b) => a.position - b.position);
    if (!changes.length || changes[0]!.position > 0) segments.push({ beat: 0, bpm });
    for (const c of changes) {
      bpm = c.bpm;
      const b = c.position * bar.quarters;
      if (segments.length && segments[segments.length - 1]!.beat === b) segments[segments.length - 1]!.bpm = bpm;
      else segments.push({ beat: b, bpm });
    }
    let durationMs = 0;
    segments.forEach((s, k) => {
      const end = k + 1 < segments.length ? segments[k + 1]!.beat : bar.quarters;
      durationMs += ((end - s.beat) * 60000) / s.bpm;
    });
    played.push({ index, barIndex, occurrence, startBeat: beat, quarters: bar.quarters, startMs: ms, durationMs, segments, timeSignature: bar.timeSignature ?? [4, 4] });
    beat += bar.quarters;
    ms += durationMs;
  });
  return { played, totalBeats: beat, totalMs: ms };
}

/** Finds the played bar for (barIndex, occurrence). */
export function findPlayed(tl: Timeline, barIndex: number, occurrence = 0): PlayedBar | undefined {
  return tl.played.find((p) => p.barIndex === barIndex && p.occurrence === occurrence);
}

/** Absolute beat position of a point inside a played bar. */
export function beatAt(p: PlayedBar, barPosition: number): number {
  return p.startBeat + barPosition * p.quarters;
}

/** Score-time ms (written tempo) of a beat offset inside a played bar. */
export function msInBar(p: PlayedBar, beatOffset: number): number {
  let ms = 0;
  for (let k = 0; k < p.segments.length; k++) {
    const s = p.segments[k]!;
    const end = Math.min(beatOffset, k + 1 < p.segments.length ? p.segments[k + 1]!.beat : p.quarters);
    if (end <= s.beat) break;
    ms += ((end - s.beat) * 60000) / s.bpm;
  }
  return ms;
}

/** Index of the played bar containing an absolute beat position (binary search). */
export function playedAtBeat(tl: Timeline, beat: number): number {
  const p = tl.played;
  if (!p.length) return -1;
  let lo = 0;
  let hi = p.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (p[mid]!.startBeat <= beat) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Score-time ms of an absolute beat position. */
export function beatToScoreMs(tl: Timeline, beat: number): number {
  const k = playedAtBeat(tl, beat);
  if (k < 0) return 0;
  // before the first bar (e.g. a recording's intro): continue at the opening tempo
  if (beat < 0) return (beat * 60000) / tl.played[0]!.segments[0]!.bpm;
  const p = tl.played[k]!;
  return p.startMs + msInBar(p, Math.min(beat - p.startBeat, p.quarters)) + (beat > tl.totalBeats ? ((beat - tl.totalBeats) * 60000) / lastBpm(p) : 0);
}

function lastBpm(p: PlayedBar): number {
  return p.segments[p.segments.length - 1]!.bpm;
}

/** Tempo (bpm) in effect at an absolute beat position, at the written tempo. */
export function bpmAtBeat(tl: Timeline, beat: number): number {
  const k = playedAtBeat(tl, beat);
  if (k < 0) return 120;
  const p = tl.played[k]!;
  let bpm = p.segments[0]!.bpm;
  for (const s of p.segments) if (s.beat <= beat - p.startBeat) bpm = s.bpm;
  return bpm;
}

export interface Click {
  /** Absolute beat (quarter notes, played order). */
  beat: number;
  /** First click of a bar. */
  accent: boolean;
  /** Index into Timeline.played. */
  played: number;
}

/** How a time signature is counted: compound meters (6/8, 9/8, 12/8) count dotted quarters. */
export function countPattern([n, d]: [number, number]): { stepQuarters: number; count: number } {
  if (d === 8 && n % 3 === 0 && n > 3) return { stepQuarters: 1.5, count: n / 3 };
  return { stepQuarters: 4 / d, count: n };
}

/** Metronome click positions for the whole timeline. */
export function metronomeClicks(tl: Timeline): Click[] {
  const out: Click[] = [];
  for (const p of tl.played) {
    const { stepQuarters, count } = countPattern(p.timeSignature);
    for (let i = 0; i < count && i * stepQuarters < p.quarters - 1e-9; i++) {
      out.push({ beat: p.startBeat + i * stepQuarters, accent: i === 0, played: p.index });
    }
  }
  return out;
}
