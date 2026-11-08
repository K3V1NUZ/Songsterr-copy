// alphaTab reads our real fixture files, and the timing adapter produces the
// expected timeline (repeats, endings, tempo change, time-signature change).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importer, Settings } from '@coderline/alphatab';
import { scoreTimingFromAlphaTab } from '@/sync/fromAlphaTab';
import { buildTimeline } from '@/sync/timeline';

const load = (path: string) => importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync(path)), new Settings());

describe('alphaTab + timing adapter', () => {
  it('reads Greensleeves (MusicXML)', () => {
    const score = load('public/samples/greensleeves.musicxml');
    expect(score.title).toBe('Greensleeves');
    expect(score.tracks.map((t) => t.name)).toEqual(['Melody', 'Rhythm', 'Bass']);
    const tl = buildTimeline(scoreTimingFromAlphaTab(score));
    expect(tl.played).toHaveLength(33);
    expect(tl.totalMs).toBeCloseTo(59400, 0); // 33 bars of 3/4 at 100 bpm
  });

  for (const file of ['public/samples/demo-riff.musicxml', 'tests/fixtures/demo-riff.gp5', 'tests/fixtures/demo-riff.gpx', 'tests/fixtures/demo-riff.gp']) {
    it(`reads the demo riff with repeats, endings and tempo change (${file.split('/').pop()})`, () => {
      const score = load(file);
      expect(score.tracks).toHaveLength(4);
      const tl = buildTimeline(scoreTimingFromAlphaTab(score));
      // intro x2 with endings: 0, 1 (ending 1), 0, 2 (ending 2), then 3..6
      expect(tl.played.map((p) => p.barIndex)).toEqual([0, 1, 0, 2, 3, 4, 5, 6]);
      expect(tl.played.map((p) => p.occurrence)).toEqual([0, 0, 1, 0, 0, 0, 0, 0]);
      // 4 bars at 112 bpm, then 120 bpm: 4/4, 4/4, 2/4, 4/4
      expect(tl.totalMs).toBeCloseTo((4 * 4 * 60000) / 112 + (14 * 60000) / 120, 0);
    });
  }
});
