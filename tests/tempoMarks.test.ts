import { describe, expect, it } from 'vitest';
import { buildTimeline, type BarTiming } from '@/sync/timeline';
import { createSyncMap } from '@/sync/syncMap';
import {
  addMark, layoutMarks, setMarkSignature, marksFromSyncPoints, moveMark, removeMark, setMarkBpm, shiftMarks, simplifyMarks, syncPointsFromMarks, tempoLabels,
} from '@/sync/tempoMarks';
import type { SyncPoint, TempoMark } from '@/data/types';

const bar = (over: Partial<BarTiming> = {}): BarTiming => ({ quarters: 4, tempoChanges: [], isRepeatStart: false, repeatCount: 0, alternateEndings: 0, ...over });
// 8 bars of 4/4, written at 120 bpm (2 s per bar)
const tl = buildTimeline({ initialBpm: 120, bars: Array.from({ length: 8 }, () => bar()) });
const mark = (barIndex: number, ms: number, bpm: number): TempoMark => ({ barIndex, barOccurence: 0, millisecondOffset: ms, bpm });
const times = (marks: TempoMark[]) => marks.map((m) => Math.round(m.millisecondOffset));
/** Recording time of each bar start (0..7) under the marks. */
const barTimes = (marks: TempoMark[]) => {
  const map = createSyncMap(tl, syncPointsFromMarks(tl, marks));
  return tl.played.map((p) => Math.round(map.beatToMs(p.startBeat)));
};

describe('tempo marks', () => {
  it('a single mark sets the tempo for the whole song', () => {
    expect(barTimes([mark(0, 1000, 60)])).toEqual([1000, 5000, 9000, 13000, 17000, 21000, 25000, 29000]);
  });

  it('each mark sets the tempo from its bar on; later marks follow', () => {
    const marks = layoutMarks(tl, [mark(0, 0, 120), mark(4, 0, 60)]);
    expect(times(marks)).toEqual([0, 8000]);
    expect(barTimes(marks)).toEqual([0, 2000, 4000, 6000, 8000, 12000, 16000, 20000]);
  });

  it('changing a BPM moves only the bars after that mark', () => {
    const marks = setMarkBpm(tl, layoutMarks(tl, [mark(0, 0, 120), mark(4, 0, 60)]), 0, 60);
    expect(barTimes(marks)).toEqual([0, 4000, 8000, 12000, 16000, 20000, 24000, 28000]);
    expect(marks[1]!.bpm).toBe(60);
  });

  it('adding a mark keeps the timing', () => {
    const before = layoutMarks(tl, [mark(0, 500, 100)]);
    const after = addMark(tl, before, 3);
    expect(after).toHaveLength(2);
    expect(barTimes(after)).toEqual(barTimes(before));
  });

  it('dragging a mark changes the BPM before it; the first mark moves everything', () => {
    const marks = layoutMarks(tl, [mark(0, 0, 120), mark(2, 0, 120)]);
    const dragged = moveMark(tl, marks, 1, 8000); // bar 3 at 8 s -> first two bars at 60 bpm
    expect(dragged[0]!.bpm).toBeCloseTo(60);
    expect(barTimes(dragged).slice(0, 4)).toEqual([0, 4000, 8000, 10000]);
    expect(times(moveMark(tl, marks, 0, 1500))).toEqual([1500, 5500]);
    expect(times(shiftMarks(marks, -200))).toEqual([-200, 3800]);
  });

  it('removing a mark lets the previous BPM carry on', () => {
    const marks = layoutMarks(tl, [mark(0, 0, 120), mark(2, 0, 60), mark(5, 0, 120)]);
    expect(barTimes(removeMark(tl, marks, 1))).toEqual([0, 2000, 4000, 6000, 8000, 10000, 12000, 14000]);
    expect(removeMark(tl, marks, 0)).toBe(marks);
  });

  it('converts old sync points into marks with the same timing', () => {
    const pts: SyncPoint[] = [0, 3, 6].map((b, i) => ({ barIndex: b, barOccurence: 0, barPosition: 0, millisecondOffset: [1000, 7000, 16000][i]! }));
    const marks = marksFromSyncPoints(tl, pts);
    expect(marks.map((m) => Math.round(m.bpm))).toEqual([120, 80, 80]);
    expect(barTimes(marks).slice(0, 7)).toEqual([1000, 3000, 5000, 7000, 10000, 13000, 16000]);
  });

  it('simplifying drops marks that only wobble', () => {
    const wobbly = [0, 1, 2, 3, 4, 5, 6, 7].map((b) => mark(b, 0, b < 4 ? 120 + (b % 2 ? 0.4 : -0.4) : 90));
    const simple = simplifyMarks(tl, wobbly, 30);
    expect(simple.map((m) => m.barIndex)).toEqual([0, 4]);
    expect(Math.round(simple[1]!.bpm)).toBe(90);
  });

  it('a mark can change the bar length until the next mark (4/4, one bar of 2/4, 4/4)', () => {
    // bar 3 is played as 2/4 in the recording although the score writes 4/4
    let marks = layoutMarks(tl, [mark(0, 0, 120)]);
    marks = addMark(tl, marks, 2);
    marks = setMarkSignature(tl, marks, 1, [2, 4]);
    marks = addMark(tl, marks, 3);
    expect(marks[2]!.timeSignature).toEqual([2, 4]); // a new mark takes over the bar length…
    marks = setMarkSignature(tl, marks, 2, undefined); // …until set back to the written one
    expect(barTimes(marks)).toEqual([0, 2000, 4000, 5000, 7000, 9000, 11000, 13000]);
    // dragging the mark after the 2/4 bar changes the BPM of that bar only
    const dragged = moveMark(tl, marks, 2, 6000);
    expect(dragged[1]!.bpm).toBeCloseTo(60);
    expect(barTimes(dragged).slice(2, 5)).toEqual([4000, 6000, 8000]);
  });

  it('labels the bars where the (rounded) tempo changes', () => {
    const labels = tempoLabels(tl, [mark(0, 0, 120), mark(2, 0, 120.2), mark(5, 0, 96)]);
    expect([...labels]).toEqual([[0, '120'], [5, '96']]);
  });
});
