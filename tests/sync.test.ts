import { describe, expect, it } from 'vitest';
import { buildTimeline, playOrder, beatToScoreMs, metronomeClicks, type BarTiming, type ScoreTiming } from '@/sync/timeline';
import { createSyncMap, effectiveBpm, pinSyncPoint, retimeSyncPoints, shiftSyncPoints, syncPointsFromOffset } from '@/sync/syncMap';
import type { SyncPoint } from '@/data/types';

const bar = (over: Partial<BarTiming> = {}): BarTiming => ({ quarters: 4, tempoChanges: [], isRepeatStart: false, repeatCount: 0, alternateEndings: 0, ...over });
const timing = (bars: BarTiming[], initialBpm = 120): ScoreTiming => ({ initialBpm, bars });
const sp = (barIndex: number, ms: number, barOccurence = 0, barPosition = 0): SyncPoint => ({ barIndex, barOccurence, barPosition, millisecondOffset: ms });

describe('playOrder', () => {
  it('plays straight through without repeats', () => {
    expect(playOrder([bar(), bar(), bar()])).toEqual([0, 1, 2]);
  });
  it('expands a repeat with a play count', () => {
    expect(playOrder([bar({ isRepeatStart: true }), bar({ repeatCount: 3 }), bar()])).toEqual([0, 1, 0, 1, 0, 1, 2]);
  });
  it('handles alternate endings', () => {
    expect(playOrder([bar({ isRepeatStart: true }), bar({ alternateEndings: 0b01, repeatCount: 2 }), bar({ alternateEndings: 0b10 }), bar()])).toEqual([0, 1, 0, 2, 3]);
  });
  it('repeats from the start when there is no repeat-start bar', () => {
    expect(playOrder([bar(), bar({ repeatCount: 2 }), bar()])).toEqual([0, 1, 0, 1, 2]);
  });
  it('handles two repeat sections in a row', () => {
    expect(playOrder([bar({ isRepeatStart: true }), bar({ repeatCount: 2 }), bar({ isRepeatStart: true }), bar({ repeatCount: 2 })])).toEqual([0, 1, 0, 1, 2, 3, 2, 3]);
  });
});

describe('buildTimeline', () => {
  it('computes bar times and occurrences', () => {
    const tl = buildTimeline(timing([bar({ isRepeatStart: true }), bar({ repeatCount: 2 }), bar()], 60));
    expect(tl.played.map((p) => [p.barIndex, p.occurrence, p.startMs])).toEqual([[0, 0, 0], [1, 0, 4000], [0, 1, 8000], [1, 1, 12000], [2, 0, 16000]]);
    expect(tl.totalMs).toBe(20000);
    expect(tl.totalBeats).toBe(20);
  });
  it('handles tempo changes inside a bar and carries tempo over', () => {
    // 60 bpm, halfway through bar 0 the tempo becomes 120
    const tl = buildTimeline(timing([bar({ tempoChanges: [{ position: 0.5, bpm: 120 }] }), bar()], 60));
    expect(tl.played[0]!.durationMs).toBe(2000 + 1000);
    expect(tl.played[1]!.durationMs).toBe(2000);
    expect(beatToScoreMs(tl, 3)).toBe(2500);
  });
  it('supports odd time signatures', () => {
    const tl = buildTimeline(timing([bar({ quarters: 3 }), bar({ quarters: 3.5 })], 120));
    expect(tl.totalMs).toBe(1500 + 1750);
  });
});

describe('sync map', () => {
  const tl = buildTimeline(timing([bar(), bar(), bar(), bar()], 60)); // 4 s per bar, 16 beats

  it('a single sync point is a plain offset', () => {
    const m = createSyncMap(tl, [sp(0, 2000)]);
    expect(m.beatToMs(0)).toBe(2000);
    expect(m.beatToMs(4)).toBe(6000);
    expect(m.msToBeat(10000)).toBeCloseTo(8, 6);
  });
  it('interpolates linearly in beats between sync points', () => {
    const m = createSyncMap(tl, [sp(0, 1000), sp(2, 11000)]); // 8 beats in 10 s
    expect(m.beatToMs(4)).toBe(6000);
    expect(m.msToBeat(6000)).toBe(4);
  });
  it('extrapolates with the nearest segment speed', () => {
    const m = createSyncMap(tl, [sp(0, 1000), sp(2, 11000)]);
    expect(m.beatToMs(12)).toBeCloseTo(16000, 6); // 4 more beats at 1.25 s per beat
    expect(m.beatToMs(-2)).toBeCloseTo(-1500, 6);
    expect(m.msToBeat(16000)).toBeCloseTo(12, 4);
  });
  it('round-trips ms -> beat -> ms', () => {
    const m = createSyncMap(tl, [sp(0, 500), sp(1, 4200), sp(3, 13000)]);
    for (const ms of [0, 500, 3000, 4200, 9000, 13000, 20000]) expect(m.beatToMs(m.msToBeat(ms))).toBeCloseTo(ms, 3);
  });
  it('respects bar occurrences inside repeats', () => {
    const rep = buildTimeline(timing([bar({ isRepeatStart: true }), bar({ repeatCount: 2 }), bar()], 60));
    // second time through bar 0 is pinned 1 s late
    const m = createSyncMap(rep, [sp(0, 0), sp(0, 9000, 1)]);
    const loc = m.locate(9000);
    expect([loc.barIndex, loc.occurrence, loc.barPosition]).toEqual([0, 1, 0]);
    expect(m.beatToMs(8)).toBe(9000);
  });
  it('locates bar position', () => {
    const m = createSyncMap(tl, [sp(0, 0)]);
    const loc = m.locate(6000);
    expect(loc.barIndex).toBe(1);
    expect(loc.barPosition).toBeCloseTo(0.5, 6);
  });
  it('ignores points that run backwards or point at missing bars', () => {
    const m = createSyncMap(tl, [sp(0, 5000), sp(1, 4000), sp(99, 1)]);
    expect(m.anchors).toHaveLength(1);
  });
});

describe('sync point helpers', () => {
  const tl = buildTimeline(timing([bar(), bar(), bar(), bar()], 60));
  it('builds points from an offset and speed', () => {
    const pts = syncPointsFromOffset(tl, 2000, 0.5, 2);
    expect(pts.map((p) => [p.barIndex, p.millisecondOffset])).toEqual([[0, 2000], [2, 18000], [3, 26000]]);
  });
  it('shifts all points', () => {
    expect(shiftSyncPoints([sp(0, 100), sp(1, 200)], 50).map((p) => p.millisecondOffset)).toEqual([150, 250]);
  });
  it('pinning a bar drops points that would cross it', () => {
    const pts = [sp(0, 0), sp(1, 4000), sp(2, 8000), sp(3, 12000)];
    const out = pinSyncPoint(tl, pts, sp(1, 9000));
    expect(out.map((p) => [p.barIndex, p.millisecondOffset])).toEqual([[0, 0], [1, 9000], [3, 12000]]);
  });
  it('reads the recording tempo from the points', () => {
    expect(effectiveBpm(tl, [sp(0, 1000)])).toBe(60);
    expect(effectiveBpm(tl, [sp(0, 1000), sp(3, 7000)])).toBeCloseTo(120);
  });
  it('re-timing to a new BPM moves the bars closer or further apart, keeping the first point', () => {
    const faster = retimeSyncPoints(tl, [sp(0, 1000), sp(2, 9000), sp(3, 13000)], 120);
    expect(faster.map((p) => p.millisecondOffset)).toEqual([1000, 5000, 7000]);
    const slower = retimeSyncPoints(tl, faster, 30);
    expect(slower.map((p) => p.millisecondOffset)).toEqual([1000, 17000, 25000]);
  });
  it('re-timing a single point adds a partner so the spacing changes', () => {
    const out = retimeSyncPoints(tl, [sp(1, 5000)], 120);
    expect(createSyncMap(tl, out).beatToMs(8)).toBeCloseTo(7000);
    expect(effectiveBpm(tl, out)).toBeCloseTo(120);
  });
});

describe('metronome clicks', () => {
  it('clicks every beat with an accent on the downbeat', () => {
    const tl = buildTimeline(timing([bar({ timeSignature: [3, 4], quarters: 3 }), bar({ timeSignature: [3, 4], quarters: 3 })]));
    expect(metronomeClicks(tl).map((c) => [c.beat, c.accent])).toEqual([[0, true], [1, false], [2, false], [3, true], [4, false], [5, false]]);
  });
  it('counts compound meters in dotted quarters and follows repeats', () => {
    const tl = buildTimeline(timing([bar({ timeSignature: [6, 8], quarters: 3, isRepeatStart: true, repeatCount: 2 })]));
    expect(metronomeClicks(tl).map((c) => c.beat)).toEqual([0, 1.5, 3, 4.5]);
  });
  it('handles eighth-note meters like 7/8', () => {
    const tl = buildTimeline(timing([bar({ timeSignature: [7, 8], quarters: 3.5 })]));
    expect(metronomeClicks(tl)).toHaveLength(7);
  });
});
