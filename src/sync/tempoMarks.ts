// Tempo marks: the editable form of a sync.
//
// A mark sits on the start of a bar (in played order) and says "from here on the recording plays at
// this BPM" (quarter notes per minute), until the next mark. Only the first mark has a free time;
// every later mark's time follows from the marks before it. So changing a mark's BPM moves all bars
// after it, and dragging a mark changes the BPM of the mark before it.
//
// A mark can also set the bar length (time signature) from its bar until the next mark, for when the
// recording's bars differ from the score's. Such bars get a sync point each, so the player squeezes
// or stretches them to the given length.
//
// The player still works with sync points; `syncPointsFromMarks` turns marks into them.
import type { SyncPoint, TempoMark } from '@/data/types';
import { createSyncMap, toAnchors } from './syncMap';
import { bpmAtBeat, findPlayed, type Timeline } from './timeline';

export const MIN_BPM = 20;
export const MAX_BPM = 400;
const clampBpm = (bpm: number) => Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));

/** Index (in played order) of a mark's bar, or -1 if the bar isn't played. */
export function markIndex(tl: Timeline, m: Pick<TempoMark, 'barIndex' | 'barOccurence'>): number {
  const p = findPlayed(tl, m.barIndex, m.barOccurence);
  return p ? tl.played.indexOf(p) : -1;
}

/** Length in quarter notes of played bar `k` under mark `m` (its time signature, or as written). */
function barQuarters(tl: Timeline, m: TempoMark, k: number): number {
  const sig = m.timeSignature;
  return sig ? (sig[0] * 4) / sig[1] : tl.played[k]!.quarters;
}

/** Recording beats (quarters) from the start of played bar `from` to the start of `to`, under mark `m`. */
function beatsUnder(tl: Timeline, m: TempoMark, from: number, to: number): number {
  let q = 0;
  for (let k = from; k < to; k++) q += barQuarters(tl, m, k);
  return q;
}

/** Sorts marks in played order, drops unknown/duplicate bars and recomputes every time after the first. */
export function layoutMarks(tl: Timeline, marks: TempoMark[]): TempoMark[] {
  const known = marks
    .map((m) => ({ m, k: markIndex(tl, m) }))
    .filter((x) => x.k >= 0)
    .sort((a, b) => a.k - b.k)
    .filter((x, i, all) => i === 0 || x.k !== all[i - 1]!.k);
  const out: TempoMark[] = [];
  for (const { m, k } of known) {
    const prev = out[out.length - 1];
    let ms = m.millisecondOffset;
    if (prev) ms = prev.millisecondOffset + (beatsUnder(tl, prev, markIndex(tl, prev), k) * 60000) / prev.bpm;
    out.push({ ...m, millisecondOffset: ms, bpm: clampBpm(m.bpm) });
  }
  return out;
}

/**
 * Sync points for the player: one per mark, one per bar where a mark changes the bar length, and one
 * near the end so the last BPM holds to the end of the song.
 */
export function syncPointsFromMarks(tl: Timeline, marks: TempoMark[]): SyncPoint[] {
  const laid = layoutMarks(tl, marks);
  const pts: SyncPoint[] = [];
  const point = (k: number, position: number, ms: number) => {
    const p = tl.played[k]!;
    pts.push({ barIndex: p.barIndex, barOccurence: p.occurrence, barPosition: position, millisecondOffset: ms });
  };
  const lastBar = tl.played.length - 1;
  laid.forEach((m, i) => {
    const from = markIndex(tl, m);
    const next = laid[i + 1];
    const to = next ? markIndex(tl, next) : lastBar;
    point(from, 0, m.millisecondOffset);
    // bars of a changed length each need their own point; otherwise the next point is enough
    const step = m.timeSignature ? 1 : Math.max(1, to - from);
    let ms = m.millisecondOffset;
    for (let k = from; k < to; ) {
      const end = Math.min(to, k + step);
      ms += (beatsUnder(tl, m, k, end) * 60000) / m.bpm;
      if (end === to && next) break; // the next mark adds this point
      point(end, 0, ms);
      k = end;
    }
    if (!next) {
      // halfway through the last bar, so its own speed is known too
      ms = m.millisecondOffset + (beatsUnder(tl, m, from, lastBar) * 60000) / m.bpm;
      point(lastBar, 0.5, ms + (barQuarters(tl, m, lastBar) * 0.5 * 60000) / m.bpm);
    }
  });
  // drop duplicates (a point on the last bar's start can come from both loops)
  return pts.filter((p, i) => i === 0 || p.barIndex !== pts[i - 1]!.barIndex || p.barOccurence !== pts[i - 1]!.barOccurence || p.barPosition !== pts[i - 1]!.barPosition);
}

/**
 * Marks from existing sync points (older songs, auto-sync results). Each anchor becomes a mark whose
 * BPM makes it reach the next anchor; anchors inside a bar are skipped (marks sit on bar starts).
 */
export function marksFromSyncPoints(tl: Timeline, points: SyncPoint[], fallbackBpm?: number): TempoMark[] {
  if (!tl.played.length) return [];
  const map = createSyncMap(tl, points);
  // bar starts that carry an anchor (or the first bar when there are none)
  const anchors = toAnchors(tl, points);
  const bars = new Set<number>();
  for (const a of anchors) {
    const k = tl.played.findIndex((p) => Math.abs(p.startBeat - a.beat) < 1e-6);
    if (k >= 0) bars.add(k);
  }
  if (!bars.size) bars.add(0);
  const ks = [...bars].sort((a, b) => a - b);
  const startBpm = fallbackBpm ?? bpmAtBeat(tl, 0);
  return ks.map((k, i) => {
    const p = tl.played[k]!;
    const ms = map.beatToMs(p.startBeat);
    const next = ks[i + 1] !== undefined ? tl.played[ks[i + 1]!]! : undefined;
    let bpm: number;
    if (next) bpm = ((next.startBeat - p.startBeat) * 60000) / (map.beatToMs(next.startBeat) - ms);
    else if (anchors.length > 1) bpm = 60000 / (map.beatToMs(p.startBeat + 1) - ms); // keep the tail's speed
    else bpm = startBpm;
    return { barIndex: p.barIndex, barOccurence: p.occurrence, millisecondOffset: ms, bpm: clampBpm(bpm) };
  });
}

/**
 * Keeps only the marks needed to stay within `toleranceMs` of the given marks' timing, so small
 * wobbles (auto-sync, tapping) don't turn into a tempo change on every bar.
 */
export function simplifyMarks(tl: Timeline, marks: TempoMark[], toleranceMs = 25): TempoMark[] {
  const laid = layoutMarks(tl, marks);
  // bar lengths set by hand are deliberate: leave those songs as they are
  if (laid.length <= 2 || laid.some((m) => m.timeSignature)) return laid;
  const beatOf = (m: TempoMark) => tl.played[markIndex(tl, m)]!.startBeat;
  // the full timing, including the end of the song, as (beat, ms) samples
  const pts = syncPointsFromMarks(tl, laid);
  const samples = toAnchors(tl, pts);
  const kept: TempoMark[] = [laid[0]!];
  let i = 0; // index into samples of the last kept mark
  while (i < samples.length - 1) {
    let j = i + 1;
    // extend as far as a straight line from i still matches every sample in between
    while (j + 1 < samples.length) {
      const a = samples[i]!, b = samples[j + 1]!;
      const slope = (b.ms - a.ms) / (b.beat - a.beat);
      let ok = true;
      for (let k = i + 1; k <= j; k++) {
        const s = samples[k]!;
        if (Math.abs(a.ms + (s.beat - a.beat) * slope - s.ms) > toleranceMs) { ok = false; break; }
      }
      if (!ok) break;
      j++;
    }
    const a = samples[i]!, b = samples[j]!;
    kept[kept.length - 1] = { ...kept[kept.length - 1]!, bpm: clampBpm(((b.beat - a.beat) * 60000) / (b.ms - a.ms)) };
    if (j >= samples.length - 1) break;
    const next = laid.find((m) => Math.abs(beatOf(m) - b.beat) < 1e-6);
    if (!next) break;
    kept.push({ ...next });
    i = j;
  }
  return layoutMarks(tl, kept);
}

/** Recording time of a bar start under the given marks. */
export function barStartMs(tl: Timeline, marks: TempoMark[], playedIndex: number): number {
  const p = tl.played[playedIndex];
  if (!p) return 0;
  return createSyncMap(tl, syncPointsFromMarks(tl, marks)).beatToMs(p.startBeat);
}

/** The mark in effect at a played bar (the last mark at or before it). */
export function markAt(tl: Timeline, marks: TempoMark[], playedIndex: number): number {
  let found = 0;
  marks.forEach((m, i) => { if (markIndex(tl, m) <= playedIndex) found = i; });
  return found;
}

/** Adds a mark at a bar without changing any timing (it takes over the BPM in effect there). */
export function addMark(tl: Timeline, marks: TempoMark[], playedIndex: number): TempoMark[] {
  const p = tl.played[playedIndex];
  if (!p || marks.some((m) => markIndex(tl, m) === playedIndex)) return marks;
  const ms = barStartMs(tl, marks, playedIndex);
  const before = marks.filter((m) => markIndex(tl, m) < playedIndex);
  const governing = before[before.length - 1];
  const bpm = governing ? governing.bpm : (marks[0]?.bpm ?? bpmAtBeat(tl, 0));
  // it takes over the bar length too, so nothing moves
  const sig = governing?.timeSignature;
  return layoutMarks(tl, [...marks, { barIndex: p.barIndex, barOccurence: p.occurrence, millisecondOffset: ms, bpm, ...(sig ? { timeSignature: sig } : {}) }]);
}

/** Sets the BPM from mark `i` onwards; later marks move, keeping their own BPM. */
export function setMarkBpm(tl: Timeline, marks: TempoMark[], i: number, bpm: number): TempoMark[] {
  if (!marks[i] || !(bpm > 0)) return marks;
  return layoutMarks(tl, marks.map((m, k) => (k === i ? { ...m, bpm } : m)));
}

/**
 * Drags mark `i` to `ms`. The first mark moves everything; any other mark changes the BPM of the
 * mark before it so this bar lands at `ms` (bars after it follow).
 */
export function moveMark(tl: Timeline, marks: TempoMark[], i: number, ms: number): TempoMark[] {
  const m = marks[i];
  if (!m) return marks;
  if (i === 0) return shiftMarks(marks, ms - m.millisecondOffset);
  const prev = marks[i - 1]!;
  const beats = beatsUnder(tl, prev, markIndex(tl, prev), markIndex(tl, m));
  const minMs = prev.millisecondOffset + (beats * 60000) / MAX_BPM;
  const maxMs = prev.millisecondOffset + (beats * 60000) / MIN_BPM;
  const to = Math.min(maxMs, Math.max(minMs, ms));
  return setMarkBpm(tl, marks, i - 1, (beats * 60000) / (to - prev.millisecondOffset));
}

/** Sets the bar length from mark `i` until the next mark (`undefined` = as written in the score). */
export function setMarkSignature(tl: Timeline, marks: TempoMark[], i: number, sig: [number, number] | undefined): TempoMark[] {
  if (!marks[i]) return marks;
  return layoutMarks(tl, marks.map((m, k) => {
    if (k !== i) return m;
    const { timeSignature: _, ...rest } = m;
    return sig ? { ...rest, timeSignature: sig } : rest;
  }));
}

/** Removes mark `i` (not the first); the BPM before it carries on. */
export function removeMark(tl: Timeline, marks: TempoMark[], i: number): TempoMark[] {
  if (i <= 0 || !marks[i]) return marks;
  return layoutMarks(tl, marks.filter((_, k) => k !== i));
}

/** Played bars whose length a mark changes: played index -> time signature (for the metronome). */
export function barLengthOverrides(tl: Timeline, marks: TempoMark[]): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  const laid = layoutMarks(tl, marks);
  laid.forEach((m, i) => {
    if (!m.timeSignature) return;
    const next = laid[i + 1];
    const end = next ? markIndex(tl, next) : tl.played.length;
    for (let k = markIndex(tl, m); k < end; k++) out.set(k, m.timeSignature);
  });
  return out;
}

/** Moves the whole song in time. */
export function shiftMarks(marks: TempoMark[], deltaMs: number): TempoMark[] {
  return marks.map((m) => ({ ...m, millisecondOffset: m.millisecondOffset + deltaMs }));
}

/**
 * Tempo labels to draw above the bars: masterbar index -> text. A label appears where the rounded
 * BPM changes (and on the first mark).
 */
export function tempoLabels(tl: Timeline, marks: TempoMark[]): Map<number, string> {
  const labels = new Map<number, string[]>();
  let last: number | null = null;
  for (const m of layoutMarks(tl, marks)) {
    const bpm = Math.round(m.bpm);
    if (bpm === last) continue;
    last = bpm;
    const list = labels.get(m.barIndex) ?? [];
    list.push(String(bpm));
    labels.set(m.barIndex, list);
  }
  return new Map([...labels].map(([k, v]) => [k, v.join(' / ')]));
}
