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
  // no bar number on the very first bar
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      const first = staff.bars[0];
      if (!first) continue;
      first.tabDisplay = { ...first.tabDisplay, barNumber: model.BarNumberDisplay.Hide };
      first.scoreDisplay = { ...first.scoreDisplay, barNumber: model.BarNumberDisplay.Hide };
    }
  }
  const s = score.stylesheet;
  s.tabConfig = { ...s.tabConfig, clef: { isVisible: false } };
  s.globalDisplayTuning = true;
  s.tuningDisplayMode = model.TuningDisplayMode.Staff;
}

interface Canvas {
  font: model.Font;
  color: model.Color;
  textAlign: number;
  textBaseline: number;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}
interface TimeSigGlyph {
  _numerator: number;
  _denominator: number;
  x: number;
  y: number;
  width: number;
  renderer: TabRenderer;
  doLayout(): void;
  paint(cx: number, cy: number, canvas: Canvas): void;
}
interface TabRenderer {
  bar: { staff: { tuning: number[] } };
  resources: { mainGlyphColor: model.Color };
  scoreRenderer: { canvas: Canvas };
  addPreBeatGlyph(g: object): void;
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
      // tab time signatures: plain sans-serif digits spanning the strings instead of the engraved font
      const addPre = proto.addPreBeatGlyph;
      let timeSigPatched = false;
      proto.addPreBeatGlyph = function (this: TabRenderer, g: object) {
        if (!timeSigPatched && '_numerator' in g && '_denominator' in g) {
          timeSigPatched = true;
          patchTimeSignature(Object.getPrototypeOf(g) as TimeSigGlyph);
        }
        addPre.call(this, g);
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

const sansFamilies = () => {
  const list = getComputedStyle(document.documentElement).getPropertyValue('--font-sans')
    .split(',').map((f) => f.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  return list.length ? list : ['Arial', 'sans-serif'];
};
const TEXT_CENTER = 1;
const BASELINE_MIDDLE = 1;

function patchTimeSignature(proto: TimeSigGlyph): void {
  const span = (g: TimeSigGlyph) => (g.renderer.bar.staff.tuning.length - 1) * g.renderer.lineSpacing;
  const font = (g: TimeSigGlyph) => model.Font.withFamilyList(sansFamilies(), (span(g) / 2) * 1.25);
  const doLayout = proto.doLayout;
  proto.doLayout = function (this: TimeSigGlyph) {
    doLayout.call(this);
    const canvas = this.renderer.scoreRenderer.canvas;
    const old = canvas.font;
    canvas.font = font(this);
    this.width = Math.max(canvas.measureText(String(this._numerator)).width, canvas.measureText(String(this._denominator)).width);
    canvas.font = old;
  };
  proto.paint = function (this: TimeSigGlyph, cx: number, cy: number, canvas: Canvas) {
    const { font: oldFont, color: oldColor, textAlign, textBaseline } = canvas;
    canvas.font = font(this);
    canvas.color = this.renderer.resources.mainGlyphColor;
    canvas.textAlign = TEXT_CENTER;
    canvas.textBaseline = BASELINE_MIDDLE;
    const x = cx + this.x + this.width / 2;
    const y = cy + this.y;
    const q = span(this) / 4;
    canvas.fillText(String(this._numerator), x, y - q);
    canvas.fillText(String(this._denominator), x, y + q);
    Object.assign(canvas, { font: oldFont, color: oldColor, textAlign, textBaseline });
  };
}
