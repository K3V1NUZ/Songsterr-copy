// Anchors: the time map, manual edits, locked anchors and migration (docs/SYNC_ENGINE.md §7, §8).
import { describe, expect, it } from 'vitest';
import {
  anchorsFromSyncPoints, anchorsFromTempo, anchorsToPlayerPoints, barConfidence, barTempos, fitToLocks, moveAnchor, pinStart, shiftAll, shiftFrom,
  tempoLabels, unpin,
} from '@/sync/anchors';
import { scoreBeats } from '@/sync/scoreBeats';
import { createSyncMap } from '@/sync/syncMap';
import { createTimeMap } from '@/sync/timeMap';
import { buildTimeline, type BarTiming } from '@/sync/timeline';
import type { Anchor } from '@/sync/types';

const bar = (o: Partial<BarTiming> = {}): BarTiming => ({ quarters: 4, tempoChanges: [], isRepeatStart: false, repeatCount: 0, alternateEndings: 0, ...o });
const tl = buildTimeline({ initialBpm: 120, bars: [bar(), bar(), bar(), bar()] }); // 16 beats, 0.5 s each
const beats = scoreBeats(tl);
const steady = () => anchorsFromTempo(beats, 1, 1); // beat j at 1 + j/2
const times = (a: Anchor[]) => a.map((x) => Math.round(x.time * 1000) / 1000);

describe('time map', () => {
  const map = createTimeMap([{ scoreBeat: 16, time: 8 }, { scoreBeat: 17, time: 8.49 }], 0.02);
  it('interpolates between anchors (the doc example) and adds the global offset', () => {
    expect(map.secondsAt(16.5)).toBeCloseTo(8.245 + 0.02, 6);
    expect(map.scoreBeatAt(8.245 + 0.02)).toBeCloseTo(16.5, 6);
  });
  it('extrapolates with the nearest pair outside the anchors', () => {
    expect(map.secondsAt(18)).toBeCloseTo(8.98 + 0.02, 6);
    expect(map.secondsAt(15)).toBeCloseTo(7.51 + 0.02, 6);
    expect(map.scoreBeatAt(7.51 + 0.02)).toBeCloseTo(15, 6);
  });
  it('agrees with the player sync map built from the same anchors', () => {
    const a = steady().map((x, j) => ({ ...x, time: x.time + 0.01 * Math.sin(j) }));
    const tm = createTimeMap(a, 0.05);
    const sm = createSyncMap(tl, anchorsToPlayerPoints(tl, beats, a, 0.05));
    for (const sb of [0, 2.5, 7.25, 15]) expect(sm.beatToMs(sb) / 1000).toBeCloseTo(tm.secondsAt(sb), 2);
  });
});

describe('manual edits', () => {
  it('first drag: the bar is pinned and everything moves along', () => {
    const out = moveAnchor(steady(), 4, 3.2);
    expect(out[4]).toMatchObject({ time: 3.2, source: 'manual', confidence: 1 });
    expect(times(out).slice(0, 6)).toEqual([1.2, 1.7, 2.2, 2.7, 3.2, 3.7]);
  });

  it('between two pins the bars stretch; outside them nothing changes', () => {
    let a = moveAnchor(steady(), 0, 1); // pin beat 0 where it is
    a = moveAnchor(a, 8, 5); // pin beat 8 where it is
    a = moveAnchor(a, 12, 7.4); // drag beat 12 later by 0.4 s
    expect(times(a).slice(0, 9)).toEqual(times(steady()).slice(0, 9)); // left of the pin at 8: untouched
    expect(times(a).slice(8, 13)).toEqual([5, 5.6, 6.2, 6.8, 7.4]); // 8..12 stretched
    expect(times(a).slice(12)).toEqual([7.4, 7.9, 8.4, 8.9]); // after the last pin: moved along
  });

  it("can't drag past a pin", () => {
    let a = moveAnchor(steady(), 8, 5);
    a = moveAnchor(a, 12, 2);
    expect(a[12]!.time).toBeGreaterThan(a[8]!.time);
  });

  it('shift-drag moves the bar and everything after it', () => {
    const out = shiftFrom(steady(), 4, 0.25);
    expect(times(out).slice(3, 7)).toEqual([2.5, 3.25, 3.75, 4.25]);
    expect(out[4]!.source).toBe('manual');
  });

  it('pins the start where it is', () => {
    const out = pinStart(steady());
    expect(out[0]).toMatchObject({ time: 1, source: 'manual', confidence: 1 });
    expect(out.slice(1).every((a) => a.source === 'auto')).toBe(true);
  });

  it('moves everything, and unpins', () => {
    expect(shiftAll(steady(), -1)[0]!.time).toBe(0);
    const pinned = moveAnchor(steady(), 4, 3);
    expect(unpin(pinned, 4)[4]!.source).toBe('auto');
  });
});

describe('locked anchors in re-analysis', () => {
  it('keeps the pins exactly and fits the auto anchors between them', () => {
    const auto = steady().map((a, j) => ({ ...a, time: a.time + (j === 6 ? 0.02 : 0) }));
    const locks: Anchor[] = [{ scoreBeat: 4, time: 3.1, source: 'manual', confidence: 1 }, { scoreBeat: 8, time: 5.3, source: 'manual', confidence: 1 }];
    const out = fitToLocks(auto, locks);
    expect(out[4]).toEqual(locks[0]);
    expect(out[8]).toEqual(locks[1]);
    // outside the pins: moved to meet them, fading out over 8 beats
    expect(out[3]!.time).toBeCloseTo(2.5 + 0.1 * (7 / 8));
    expect(out[0]!.time).toBeCloseTo(1 + 0.1 * (4 / 8));
    expect(out[10]!.time).toBeCloseTo(6 + 0.3 * (6 / 8));
    expect(out[15]!.time).toBeCloseTo(8.5 + 0.3 * (1 / 8));
    expect(out[6]!.time).toBeCloseTo(3.1 + ((4.02 - 3) / 2) * 2.2); // inside: detected timing kept, stretched
  });
});

describe('views and migration', () => {
  it('bar tempo, labels where it changes and the lowest confidence per bar', () => {
    const a = steady().map((x, j) => ({ ...x, confidence: 1, time: j >= 8 ? 5 + (j - 8) * 0.4 : x.time })); // bars 3–4 at 150 BPM
    expect(barTempos(tl, beats, a).map(Math.round)).toEqual([120, 120, 150, 150]);
    expect([...tempoLabels(tl, beats, a)]).toEqual([[0, '120'], [2, '150']]);
    a[5] = { ...a[5]!, confidence: 0.2 };
    expect(barConfidence(tl, beats, a)[1]).toBe(0.2);
  });

  it('turns older sync points into anchors with the same timing, pins where the points were', () => {
    const pts = [
      { barIndex: 0, barOccurence: 0, barPosition: 0, millisecondOffset: 1000 },
      { barIndex: 2, barOccurence: 0, barPosition: 0, millisecondOffset: 5000 },
      { barIndex: 3, barOccurence: 0, barPosition: 0.5, millisecondOffset: 6000 },
    ];
    const a = anchorsFromSyncPoints(tl, beats, pts, 'manual');
    expect(a).toHaveLength(16);
    expect(a[8]).toMatchObject({ time: 5, source: 'manual' });
    expect(a[4]).toMatchObject({ time: 3, source: 'auto' });
    expect(a[14]!.time).toBeCloseTo(6);
  });
});
