// Reads timing information from an alphaTab score into our pure ScoreTiming.
import type { model } from '@coderline/alphatab';
import { TICKS_PER_QUARTER, type ScoreTiming } from './timeline';

export function scoreTimingFromAlphaTab(score: model.Score): ScoreTiming {
  return {
    initialBpm: score.tempo || 120,
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
