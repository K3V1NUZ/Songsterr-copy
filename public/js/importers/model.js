// Shared import model + helpers used by the importers.
//
// Importers (Guitar Pro, MusicXML, ASCII) produce this intermediate model, which
// music.js buildSong() turns into a playable song and musicxml-writer.js can save:
//   { meta: {title, artist, album, tempo, time:[n,d], source},
//     masterBars: [{time:[n,d], tempo?, section?, repeatStart?, repeatEnd?, repeatTimes?, ending?:[1,2], pickup?}],
//     tracks: [{name, instrument, tuning:[midi low->high], capo, drums, bars: [[beat, ...], ...]}],
//     warnings: [] }
//   beat: {dur:{base:'q', dots:0, tuplet:0}, rest?, notes:[note]}
//   note: {string (1 = highest), fret}  or  {midi} (pitch only -> frets assigned here)
//         flags: tie dead ghost harmonic legato slide bend(semitones) vibrato palmMute accent letRing
//   drum note: {midi} (General MIDI percussion number)
export { gmDrum } from '../music.js';

// ---- instrument detection ---------------------------------------------------
export function instrumentFromProgram(program, { strings = 6, name = '', drums = false, lowest = 40 } = {}) {
  if (drums) return 'drums';
  const n = name.toLowerCase();
  if (/drum|perc/.test(n)) return 'drums';
  if (/bass/.test(n)) return 'bass';
  if (/ukul/.test(n)) return 'ukulele';
  // a known General MIDI program is more reliable than the track name
  if (program >= 0) {
    if (program === 24 || program === 25) return 'acoustic';
    if (program >= 26 && program <= 28) return /dist|overdr|heavy|metal/.test(n) ? 'distortion' : 'electric';
    if (program === 29 || program === 30) return 'distortion';
    if (program === 31) return 'electric';
    if (program >= 32 && program <= 39) return 'bass';
    if (program === 105) return 'banjo';
    if (strings <= 5 && lowest < 36) return 'bass';
    if (!/gu?i?ta?r|gtr/.test(n)) return 'keys';
  }
  if (/dist|overdr|heavy|metal/.test(n)) return 'distortion';
  if (/banjo/.test(n)) return 'banjo';
  if (/acous|nylon|steel|classic/.test(n)) return 'acoustic';
  if (/elec|clean|jazz|lead|rhythm|gtr|guit/.test(n)) return 'electric';
  if (/piano|key|organ|synth|string|voice|vocal|brass|sax|flute|horn|violin|cello|soprano|alto|tenor/.test(n)) return 'keys';
  if (strings <= 5 && lowest < 36) return 'bass';
  return 'guitar';
}

// ---- duration helpers ----------------------------------------------------------
const BASE_BY_VALUE = { 1: 'w', 2: 'h', 4: 'q', 8: 'e', 16: 's', 32: 't', 64: 't', 128: 't' };
export function durFromValue(value, dots = 0, tupletEnters = 0, tupletTimes = 0, warnings) {
  const base = BASE_BY_VALUE[value] || 'q';
  if (value > 32 && warnings) warnings.add(`1/${value} notes are not supported; played as 1/32`);
  let tuplet = 0;
  if (tupletEnters && !(tupletEnters === 1 && tupletTimes === 1)) {
    const key = `${tupletEnters}/${tupletTimes}`;
    tuplet = { '3/2': 3, '5/4': 5, '6/4': 6, '7/4': 7 }[key] || 0;
    if (!tuplet && warnings) warnings.add(`${key} tuplets are not supported; written as plain notes (check those bars)`);
  }
  return { base, dots: Math.min(2, dots), tuplet };
}
// break a length in quarters into representable rest durations
export function restsFor(q) {
  const table = [['w', 0, 4], ['h', 1, 3], ['h', 0, 2], ['q', 1, 1.5], ['q', 0, 1], ['e', 1, 0.75], ['e', 0, 0.5], ['s', 1, 0.375], ['s', 0, 0.25], ['t', 0, 0.125]];
  const out = [];
  let left = q;
  while (left > 0.0624) {
    const t = table.find(([, , v]) => v <= left + 1e-9);
    if (!t) break;
    out.push({ dur: { base: t[0], dots: t[1], tuplet: 0 }, rest: true, notes: [] });
    left -= t[2];
  }
  return out;
}

// ---- writer ------------------------------------------------------------------------------
export class Warnings {
  constructor() { this.set = new Map(); }
  add(msg) { this.set.set(msg, (this.set.get(msg) || 0) + 1); }
  list() { return [...this.set].map(([m, n]) => (n > 1 ? `${m} (${n}×)` : m)); }
}

export function countNotes(track) {
  let n = 0;
  for (const bar of track.bars) for (const b of bar) if (!b.rest) n += b.notes.length;
  return n;
}
