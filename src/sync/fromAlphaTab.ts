// Reads timing information from an alphaTab score into our pure ScoreTiming.
import { midi, Settings, type model } from '@coderline/alphatab';
import { TICKS_PER_QUARTER, type ScoreTiming } from './timeline';

/**
 * The order alphaTab plays the bars in (repeats, alternate endings, D.C./D.S./Coda jumps), taken from
 * its own MIDI generator so our bar passes always match the ones alphaTab uses for sync points.
 */
export function alphaTabPlayOrder(score: model.Score): number[] | undefined {
  try {
    const gen = new midi.MidiFileGenerator(score, new Settings(), new midi.AlphaSynthMidiFileHandler(new midi.MidiFile()));
    gen.generate();
    const order = gen.tickLookup.masterBars.map((b) => b.masterBar.index);
    return order.length ? order : undefined;
  } catch {
    return undefined; // fall back to our own repeat expansion
  }
}

export function scoreTimingFromAlphaTab(score: model.Score): ScoreTiming {
  const order = alphaTabPlayOrder(score);
  return {
    initialBpm: score.tempo || 120,
    ...(order ? { order } : {}),
    bars: score.masterBars.map((mb) => ({
      quarters: mb.calculateDuration(false) / TICKS_PER_QUARTER,
      tempoChanges: mb.tempoAutomations.map((a) => ({ position: a.ratioPosition, bpm: a.value })),
      isRepeatStart: mb.isRepeatStart,
      repeatCount: mb.isRepeatEnd ? Math.max(2, mb.repeatCount) : 0,
      alternateEndings: mb.alternateEndings,
      timeSignature: [mb.timeSignatureNumerator, mb.timeSignatureDenominator],
    })),
  };
}
