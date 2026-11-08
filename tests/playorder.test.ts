// The timeline's bar order must match the order alphaTab itself plays the bars in
// (otherwise sync points point at the wrong bar pass).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importer, midi, model, Settings } from '@coderline/alphatab';
import { scoreTimingFromAlphaTab } from '@/sync/fromAlphaTab';
import { buildTimeline } from '@/sync/timeline';

const settings = new Settings();
const fromFile = (path: string) => importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync(path)), settings);
const fromTex = (tex: string) => {
  const imp = new importer.AlphaTexImporter();
  imp.initFromString(tex, settings);
  return imp.readScore();
};

/** Bar order as alphaTab's MIDI generator plays it. */
function alphaTabOrder(score: model.Score): number[] {
  const gen = new midi.MidiFileGenerator(score, settings, new midi.AlphaSynthMidiFileHandler(new midi.MidiFile()));
  gen.generate();
  return gen.tickLookup.masterBars.map((b) => b.masterBar.index);
}

const ours = (score: model.Score) => buildTimeline(scoreTimingFromAlphaTab(score)).played.map((p) => p.barIndex);

describe('play order matches alphaTab', () => {
  for (const file of ['public/samples/greensleeves.musicxml', 'public/samples/demo-riff.musicxml', 'tests/fixtures/demo-riff.gp5', 'tests/fixtures/demo-riff.gp']) {
    it(file.split('/').pop()!, () => {
      const score = fromFile(file);
      expect(ours(score)).toEqual(alphaTabOrder(score));
    });
  }

  const cases: Array<[string, string]> = [
    ['one bar repeated 4 times', '\\ro \\rc 4 1.1.4 1.1.4 1.1.4 1.1.4 | 2.1.4 2.1.4 2.1.4 2.1.4 | 3.1.1'],
    ['repeat without a start sign', '1.1.1 | 2.1.1 \\rc 2 | 3.1.1'],
    ['two repeats in a row', '\\ro 1.1.1 \\rc 2 | \\ro 2.1.1 | 3.1.1 \\rc 3 | 4.1.1'],
    ['endings spanning two bars', '\\ro 1.1.1 | \\ae (1 2) 2.1.1 \\rc 3 | \\ae 3 3.1.1 | 4.1.1'],
    ['D.C. al Fine', '1.1.1 | \\jump Fine 2.1.1 | 3.1.1 | \\jump DaCapoAlFine 4.1.1'],
  ];
  for (const [name, tex] of cases) {
    it(name, () => {
      const score = fromTex(tex);
      expect(ours(score)).toEqual(alphaTabOrder(score));
    });
  }
});
