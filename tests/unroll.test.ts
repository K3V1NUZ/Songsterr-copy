import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importer, model, Settings } from '@coderline/alphatab';
import { alphaTabPlayOrder, scoreTimingFromAlphaTab } from '@/sync/fromAlphaTab';
import { buildTimeline } from '@/sync/timeline';
import { syncPointsToPlayed, unrollRepeats } from '@/sync/unroll';

const settings = new Settings();
const fromFile = (path: string) => importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync(path)), settings);
const fromTex = (tex: string) => {
  const imp = new importer.AlphaTexImporter();
  imp.initFromString(tex, settings);
  return imp.readScore();
};
/** Fret numbers of each bar of the first track, as written. */
const frets = (s: model.Score) => s.tracks[0]!.staves[0]!.bars.map((b) => b.voices[0]!.beats.map((bt) => bt.notes.map((n) => n.fret).join('+')).join(' '));

describe('writing repeats out', () => {
  it('demo riff: bars in play order, no repeat signs, same music and length', () => {
    const score = fromFile('public/samples/demo-riff.musicxml');
    const before = buildTimeline(scoreTimingFromAlphaTab(score));
    const original = frets(score);
    const { score: out, order } = unrollRepeats(score, settings);
    expect(order).toEqual([0, 1, 0, 2, 3, 4, 5, 6]);
    expect(out.masterBars).toHaveLength(8);
    expect(out.masterBars.some((mb) => mb.isRepeatStart || mb.isRepeatEnd || mb.alternateEndings)).toBe(false);
    expect(frets(out)).toEqual(order.map((i) => original[i]));
    expect(out.tracks).toHaveLength(score.tracks.length);
    // played straight through, in the same time
    expect(alphaTabPlayOrder(out)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const after = buildTimeline(scoreTimingFromAlphaTab(out));
    expect(after.totalMs).toBeCloseTo(before.totalMs, 3);
    // every beat has its own id
    const ids = out.tracks.flatMap((t) => t.staves.flatMap((st) => st.bars.flatMap((b) => b.voices.flatMap((v) => v.beats.map((bt) => bt.id)))));
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const file of ['tests/fixtures/demo-riff.gp3', 'tests/fixtures/demo-riff.gp4', 'tests/fixtures/demo-riff.gp5', 'tests/fixtures/demo-riff.gpx', 'tests/fixtures/demo-riff.gp', 'tests/fixtures/techniques.musicxml', 'tests/fixtures/greensleeves.mxl']) {
    it(`keeps the length of ${file.split('/').pop()}`, () => {
      const score = fromFile(file);
      const before = buildTimeline(scoreTimingFromAlphaTab(score));
      const { score: out } = unrollRepeats(score, settings);
      const after = buildTimeline(scoreTimingFromAlphaTab(out));
      expect(after.played).toHaveLength(before.played.length);
      expect(after.totalMs).toBeCloseTo(before.totalMs, 3);
    });
  }

  it('one bar played four times becomes four bars', () => {
    const { score, order } = unrollRepeats(fromTex('\\ro \\rc 4 1.1.4 1.1.4 1.1.4 1.1.4 | 2.1.1 | 3.1.1'), settings);
    expect(order).toEqual([0, 0, 0, 0, 1, 2]);
    expect(score.masterBars).toHaveLength(6);
  });

  it('scores without repeats are left alone', () => {
    const score = fromFile('public/samples/greensleeves.musicxml');
    expect(unrollRepeats(score, settings).score).toBe(score);
  });

  it('moves older sync data onto the written-out bars', () => {
    const order = [0, 1, 0, 2, 3];
    const pts = [
      { barIndex: 0, barOccurence: 0, barPosition: 0, millisecondOffset: 0 },
      { barIndex: 0, barOccurence: 1, barPosition: 0.5, millisecondOffset: 5000 },
      { barIndex: 3, barOccurence: 0, barPosition: 0, millisecondOffset: 9000 },
      { barIndex: 9, barOccurence: 0, barPosition: 0, millisecondOffset: 9999 },
    ];
    expect(syncPointsToPlayed(order, pts).map((p) => [p.barIndex, p.barOccurence, p.barPosition])).toEqual([[0, 0, 0], [2, 0, 0.5], [4, 0, 0]]);
  });
});
