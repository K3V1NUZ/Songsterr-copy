// Writing repeats out: the tab shows every played bar in play order (a bar played four times is
// drawn four times), so bars are numbered 1, 2, 3… as they are heard and the cursor only moves forward.
//
// The score is copied through alphaTab's own JSON form, with the bars in play order and the repeat
// signs, endings and jumps (D.C./D.S./Coda) removed.
import { model, type Settings } from '@coderline/alphatab';
import type { SyncPoint, TempoMark } from '@/data/types';
import { alphaTabPlayOrder } from './fromAlphaTab';

type Js = Map<string, unknown>;

/** Repeat/jump information that no longer applies once the bars are in play order. */
const MASTERBAR_REPEAT_KEYS = ['isrepeatstart', 'repeatcount', 'alternateendings', 'directions', 'custombarnumber', 'custombarnumbertext'];
/** Explicit barline styles may draw repeat signs; let alphaTab choose. */
const BAR_REPEAT_KEYS = ['barlineleft', 'barlineright'];

/**
 * Deep copy of alphaTab's JSON form without object ids, so every copy gets fresh ones. Notes also link
 * to each other by id (ties, hammer-ons, slides, slurs); those links are dropped too and alphaTab finds
 * ties, hammer-ons and slides again from the note order (now play order). Explicit slurs are lost.
 */
function copyWithoutIds(v: unknown): unknown {
  if (v instanceof Map) {
    const out = new Map<unknown, unknown>();
    for (const [k, x] of v) if (k !== 'id' && !(typeof k === 'string' && k.endsWith('noteid'))) out.set(k, copyWithoutIds(x));
    return out;
  }
  if (Array.isArray(v)) return v.map(copyWithoutIds);
  return v;
}

const isIdentity = (order: number[], count: number) => order.length === count && order.every((b, i) => b === i);

/**
 * The score with repeats written out, and the play order it was built from (original bar index for
 * each new bar). Scores without repeats are returned unchanged.
 */
export function unrollRepeats(score: model.Score, settings: Settings): { score: model.Score; order: number[] } {
  const count = score.masterBars.length;
  const order = alphaTabPlayOrder(score) ?? score.masterBars.map((_, i) => i);
  if (isIdentity(order, count)) return { score, order };
  const js = model.JsonConverter.scoreToJsObject(score) as Js;
  const masterBars = js.get('masterbars') as Js[];
  const seen = new Set<number>();
  js.set('masterbars', order.map((i) => {
    const mb = copyWithoutIds(masterBars[i]) as Js;
    for (const k of MASTERBAR_REPEAT_KEYS) mb.delete(k);
    if (seen.has(i)) {
      // a repeat pass: the section name and tempo marking were already shown the first time
      mb.delete('section');
      for (const a of (mb.get('tempoautomations') as Js[] | undefined) ?? []) a.set('isvisible', false);
    }
    seen.add(i);
    return mb;
  }));
  for (const track of js.get('tracks') as Js[]) {
    for (const staff of track.get('staves') as Js[]) {
      const bars = staff.get('bars') as Js[];
      staff.set('bars', order.map((i) => {
        const bar = copyWithoutIds(bars[i]) as Js;
        for (const k of BAR_REPEAT_KEYS) bar.delete(k);
        return bar;
      }));
    }
  }
  return { score: model.JsonConverter.jsObjectToScore(js, settings), order };
}

// ---- sync data saved before repeats were written out ----------------------------------------------
// Older sync points and tempo marks name a bar as (written bar, which time it is played). With repeats
// written out, played bar k is bar k, played once.

/** (written bar, occurrence) -> played index, for the given play order. */
function playedIndexLookup(order: number[]): (barIndex: number, occurrence: number) => number | undefined {
  const map = new Map<string, number>();
  const seen = new Map<number, number>();
  order.forEach((b, k) => {
    const occ = seen.get(b) ?? 0;
    seen.set(b, occ + 1);
    map.set(`${b}:${occ}`, k);
  });
  return (b, occ) => map.get(`${b}:${occ}`);
}

/** Sync points in written-bar terms -> played-bar terms (points on unknown bars are dropped). */
export function syncPointsToPlayed(order: number[], points: SyncPoint[]): SyncPoint[] {
  const at = playedIndexLookup(order);
  return points.flatMap((p) => {
    const k = at(p.barIndex, p.barOccurence);
    return k === undefined ? [] : [{ ...p, barIndex: k, barOccurence: 0 }];
  });
}

/** Tempo marks in written-bar terms -> played-bar terms. */
export function tempoMarksToPlayed(order: number[], marks: TempoMark[]): TempoMark[] {
  const at = playedIndexLookup(order);
  return marks.flatMap((m) => {
    const k = at(m.barIndex, m.barOccurence);
    return k === undefined ? [] : [{ ...m, barIndex: k, barOccurence: 0 }];
  });
}
