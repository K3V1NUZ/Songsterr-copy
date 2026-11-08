// Small engraving tweaks alphaTab has no setting for.
import { Environment, model } from '@coderline/alphatab';

/**
 * Hides the TAB clef and writes the tuning beside the strings of the first system.
 * Also enables both notations on every staff, so the view (stave profile) alone decides what is drawn —
 * files often mark guitar staves as tab-only, which made "Tab + notes" show just the tab.
 */
export function styleScore(score: model.Score): void {
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      staff.showStandardNotation = true;
      if (staff.isStringed && !staff.isPercussion) staff.showTablature = true;
    }
  }
  const s = score.stylesheet;
  s.tabConfig = { ...s.tabConfig, clef: { isVisible: false } };
  s.globalDisplayTuning = true;
  s.tuningDisplayMode = model.TuningDisplayMode.Staff;
}

interface Canvas { fillRect(x: number, y: number, w: number, h: number): void }
interface TabRenderer {
  bar: { staff: { tuning: number[] } };
  lineSpacing: number;
  smuflMetrics: { stemThickness: number };
  getLineY(line: number): number;
  getFlagTopY(beat: unknown, direction: number): number;
  paintBeamingStem(beat: { notes: unknown[] }, cy: number, x: number, topY: number, bottomY: number, canvas: Canvas): void;
}

/** y (relative to the renderer) just below the lowest string. */
const belowStrings = (r: TabRenderer) => r.getLineY(r.bar.staff.tuning.length - 1) + r.lineSpacing * 0.6;
interface RendererFactory { staffId: string; create(...args: unknown[]): object }

let patched = false;

/**
 * Tab stems start below the bottom string instead of at the note, so they never cross the strings.
 * alphaTab draws tab stems downwards from `getFlagTopY`; the patch moves that start point.
 * Needs rendering on the main thread (core.useWorkers = false), where this prototype lives.
 */
export function patchTabStems(): void {
  if (patched) return;
  const factories = (Environment as unknown as { defaultRenderers?: RendererFactory[] }).defaultRenderers;
  const factory = factories?.find((f) => f.staffId === 'tab');
  if (!factory) return;
  patched = true;
  const create = factory.create.bind(factory);
  let done = false;
  factory.create = (...args: unknown[]) => {
    const r = create(...args);
    if (!done) {
      done = true;
      const proto = Object.getPrototypeOf(r) as TabRenderer;
      const original = proto.getFlagTopY;
      proto.getFlagTopY = function (this: TabRenderer, beat: unknown, direction: number) {
        const y = original.call(this, beat, direction);
        return direction === 1 ? Math.max(y, belowStrings(this)) : y;
      };
      // alphaTab draws chord stems in pieces between the fret numbers; draw one stem below the strings instead
      proto.paintBeamingStem = function (this: TabRenderer, beat, cy, x, topY, bottomY, canvas) {
        if (beat.notes.length === 0) return;
        const from = Math.max(Math.min(topY, bottomY), cy + belowStrings(this));
        const to = Math.max(topY, bottomY);
        if (to > from) canvas.fillRect(x, from, this.smuflMetrics.stemThickness, to - from);
      };
    }
    return r;
  };
}
