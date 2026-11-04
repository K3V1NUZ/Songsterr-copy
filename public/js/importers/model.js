// Shared import model -> TabDown writer.
//
// Importers (Guitar Pro, MusicXML) produce this intermediate model:
//   { meta: {title, artist, album, tempo, time:[n,d], source},
//     masterBars: [{time:[n,d], tempo?, section?, repeatStart?, repeatEnd?, repeatTimes?, ending?:[1,2], pickup?}],
//     tracks: [{name, instrument, tuning:[midi low->high], capo, drums, bars: [[beat, ...], ...]}],
//     warnings: [] }
//   beat: {dur:{base:'q', dots:0, tuplet:0}, rest?, notes:[note]}
//   note: {string (1 = highest), fret}  or  {midi} (pitch only -> frets assigned here)
//         flags: tie dead ghost harmonic legato slide bend(semitones) vibrato palmMute accent letRing
//   drum note: {midi} (General MIDI percussion number)
import { DURATIONS, durationQuarters, midiToName, TUNING_PRESETS, parseTuning } from '../tabdown.js';

// ---- General MIDI percussion -> TabDown drum names -------------------------
const GM_DRUMS = {
  35: 'kick', 36: 'kick', 37: 'sidestick', 38: 'snare', 39: 'snare', 40: 'snare',
  41: 'tom3', 43: 'tom3', 45: 'tom2', 47: 'tom2', 48: 'tom1', 50: 'tom1',
  42: 'hihat', 44: 'pedal', 46: 'ohat', 49: 'crash', 52: 'crash', 55: 'crash', 57: 'crash',
  51: 'ride', 53: 'ride', 59: 'ride', 54: 'hihat', 56: 'sidestick', 69: 'hihat', 70: 'hihat', 82: 'hihat',
};
export const gmDrum = (midi) => GM_DRUMS[midi] || null;

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
  if (value > 32 && warnings) warnings.add(`1/${value} notes are shorter than TabDown supports; written as 1/32`);
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

// ---- pitch -> string/fret ----------------------------------------------------------
// Picks playable string/fret positions for a chord of MIDI pitches, close to the previous hand position.
export function assignFrets(midis, tuning, capo = 0, prev = { pos: 3 }, maxFret = 22) {
  const strings = tuning.length;
  const open = tuning.map((m) => m + capo).reverse(); // index 0 = string 1 (highest)
  const lowest = Math.min(...open), highest = Math.max(...open) + maxFret;
  let shifted = false;
  let notes = [...new Set(midis.map((m) => {
    let x = m;
    while (x < lowest) { x += 12; shifted = true; }
    while (x > highest) { x -= 12; shifted = true; }
    return x;
  }))].sort((a, b) => b - a);
  while (notes.length > strings) notes.splice(Math.floor(notes.length / 2), 1);
  const best = { cost: Infinity, res: null };
  const cur = [];
  const used = new Set();
  const dfs = (i) => {
    if (i === notes.length) {
      const fretted = cur.filter((c) => c.fret > 0).map((c) => c.fret);
      const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
      if (span > 5) return;
      const avg = fretted.length ? fretted.reduce((a, b) => a + b, 0) / fretted.length : prev.pos;
      const cost = span * 2 + Math.abs(avg - prev.pos) * 0.6 + cur.reduce((a, c) => a + c.fret, 0) * 0.05;
      if (cost < best.cost) { best.cost = cost; best.res = cur.map((c) => ({ ...c })); }
      return;
    }
    for (let s = 0; s < strings; s++) {
      if (used.has(s)) continue;
      const fret = notes[i] - open[s];
      if (fret < 0 || fret > maxFret) continue;
      // keep pitch order consistent with string order (higher note on higher string)
      if (cur.length && s < cur[cur.length - 1].string - 1) continue;
      used.add(s); cur.push({ string: s + 1, fret, midi: notes[i] });
      dfs(i + 1);
      cur.pop(); used.delete(s);
    }
  };
  dfs(0);
  if (!best.res) { // fall back: drop notes from the middle until it fits
    if (notes.length > 1) return assignFrets(notes.filter((_, k) => k !== Math.floor(notes.length / 2)), tuning, capo, prev, maxFret);
    return { notes: [], shifted };
  }
  const fretted = best.res.filter((c) => c.fret > 0);
  if (fretted.length) prev.pos = fretted.reduce((a, c) => a + c.fret, 0) / fretted.length;
  return { notes: best.res, shifted };
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

function tuningText(tuning, instrument) {
  const names = tuning.map((m) => midiToName(m)).join(' ');
  for (const [preset, notes] of Object.entries(TUNING_PRESETS)) {
    const p = parseTuning(notes);
    if (p && p.length === tuning.length && p.every((v, i) => v === tuning[i])) {
      if (instrument === 'bass' && !preset.startsWith('bass')) continue;
      return preset;
    }
  }
  return names;
}

const fmtDur = (d) => d.base + '.'.repeat(d.dots) + (d.tuplet ? d.tuplet : '');
const barQ = (time) => (time[0] * 4) / time[1];

export function modelToTabDown(model, { trackIndexes, source } = {}) {
  const warn = model.warnings instanceof Warnings ? model.warnings : new Warnings();
  const idx = trackIndexes ?? model.tracks.map((_, i) => i);
  const tracks = idx.map((i) => model.tracks[i]).filter(Boolean);
  const m = model.meta;
  const out = [];
  out.push(`# Imported${source ? ' from ' + source : ''} — check it with the editor (Edit button) and by ear.`);
  out.push(`title: ${m.title || 'Untitled'}`);
  if (m.artist) out.push(`artist: ${m.artist}`);
  if (m.album) out.push(`album: ${m.album}`);
  const firstTime = model.masterBars[0]?.time || m.time || [4, 4];
  const firstTempo = model.masterBars[0]?.tempo || m.tempo || 120;
  out.push(`tempo: ${Math.round(firstTempo * 100) / 100}`);
  out.push(`time: ${firstTime[0]}/${firstTime[1]}`);
  out.push('');

  tracks.forEach((t, ti) => {
    const isDrums = t.drums || t.instrument === 'drums';
    out.push(`track: ${t.name || 'Track ' + (ti + 1)}`);
    out.push(`instrument: ${isDrums ? 'drums' : t.instrument || 'guitar'}`);
    let tuning = t.tuning && t.tuning.length ? t.tuning : null;
    if (!isDrums) {
      if (!tuning || tuning.length > 7 || tuning.length < 3) {
        tuning = t.instrument === 'bass' ? parseTuning('bass') : parseTuning('standard');
        if (t.instrument !== 'keys') warn.add(`${t.name}: no usable tuning in the file, using ${t.instrument === 'bass' ? 'bass' : 'standard'} tuning`);
      }
      out.push(`tuning: ${tuningText(tuning, t.instrument)}`);
      if (t.capo) out.push(`capo: ${t.capo}`);
    }
    out.push('');
    const hand = { pos: 3 };
    const lastByMidi = new Map();
    const remember = (b) => { for (const n of b.notes) if (n.midi != null && n.string != null) lastByMidi.set(n.midi, { string: n.string, fret: n.fret }); };
    let prevTime = null, prevTempo = null;
    let line = [];
    const flushLine = () => { if (line.length) out.push(line.join(' ')); line = []; };
    model.masterBars.forEach((mb, bi) => {
      const beats = (t.bars[bi] || []).map((b) => ({ ...b, notes: b.notes.map((n) => ({ ...n })) }));
      // resolve pitch-only notes to frets
      if (!isDrums) {
        for (const b of beats) {
          // tied notes keep the string/fret of the note they continue
          for (const n of b.notes) {
            if (n.string == null && n.midi != null && n.tie && lastByMidi.has(n.midi)) Object.assign(n, lastByMidi.get(n.midi));
          }
          const pitchOnly = b.notes.filter((n) => n.string == null && n.midi != null);
          if (!pitchOnly.length) { remember(b); continue; }
          const keep = b.notes.filter((n) => n.string != null);
          const res = assignFrets(pitchOnly.map((n) => n.midi), tuning, t.capo || 0, hand);
          if (res.shifted) warn.add(`${t.name}: some notes were out of the instrument's range and moved by an octave`);
          const byMidi = new Map(pitchOnly.map((n) => [n.midi, n]));
          for (const r of res.notes) {
            const src = byMidi.get(r.midi) || pitchOnly.find((n) => (n.midi - r.midi) % 12 === 0) || {};
            keep.push({ ...src, string: r.string, fret: r.fret });
          }
          b.notes = keep.filter((n) => !keep.some((o) => o !== n && o.string === n.string && keep.indexOf(o) < keep.indexOf(n)));
          if (!b.notes.length) b.rest = true;
          remember(b);
        }
      }
      // fill or flag the bar length
      const len = barQ(mb.time);
      let sum = 0;
      for (const b of beats) sum += durationQuarters(b.dur.base, b.dur.dots, b.dur.tuplet);
      if (sum < len - 1e-6) {
        const fill = restsFor(len - sum);
        if (mb.pickup && bi === 0) beats.unshift(...fill); else beats.push(...fill);
      } else if (sum > len + 1e-6 && beats.length) warn.add(`${t.name}: some bars are longer than their time signature (bar ${bi + 1} first)`);
      if (!beats.length) beats.push(...restsFor(len));

      const toks = [];
      if (mb.repeatStart) toks.push('|:');
      if (ti === 0) {
        if (mb.section) toks.push(`{section ${mb.section.replace(/[{}]/g, '')}}`);
        const tempo = mb.tempo || prevTempo || firstTempo;
        if (bi > 0 && prevTempo != null && Math.abs(tempo - prevTempo) > 0.01) toks.push(`{tempo ${Math.round(tempo * 100) / 100}}`);
        prevTempo = tempo;
        if (prevTime && (prevTime[0] !== mb.time[0] || prevTime[1] !== mb.time[1])) toks.push(`{time ${mb.time[0]}/${mb.time[1]}}`);
        prevTime = mb.time;
        if (mb.ending?.length) toks.push(`{ending ${mb.ending.join(',')}}`);
      }
      let curDur = null;
      beats.forEach((b, k) => {
        const d = fmtDur(b.dur);
        if (d !== curDur) { toks.push(d); curDur = d; }
        let notes = b.rest ? [] : b.notes;
        let parts;
        if (isDrums) {
          const names = [];
          for (const n of notes) {
            const nm = n.drum || gmDrum(n.midi);
            if (!nm) { warn.add(`${t.name}: unsupported drum sound(s) skipped (MIDI ${n.midi})`); continue; }
            const tok = (n.ghost ? `(${nm})` : nm) + (n.accent ? '!' : '');
            if (!names.some((x) => x.replace(/[()!]/g, '') === nm)) names.push(tok);
          }
          parts = names;
        } else {
          notes = notes.filter((n) => n.string >= 1 && n.string <= tuning.length).sort((a, b2) => a.string - b2.string);
          parts = notes.map((n) => noteToken(n, legatoKind(n, beats, k, t.bars[bi + 1])));
        }
        if (!parts.length) toks.push('r');
        else toks.push(parts.length === 1 ? parts[0] : `[${parts.join(' ')}]`);
      });
      if (mb.repeatEnd) toks.push((mb.repeatTimes || 2) === 2 ? ':|' : `:|x${mb.repeatTimes}`);
      else toks.push('|');
      if (ti === 0 && mb.section) flushLine();
      line.push(toks.join(' '));
      if (line.length >= 2) flushLine();
    });
    flushLine();
    out.push('');
  });
  return { text: out.join('\n'), warnings: warn.list() };
}

function legatoKind(n, beats, k, nextBar) {
  if (!n.legato) return null;
  const later = [...beats.slice(k + 1), ...(nextBar || [])];
  for (const b of later) {
    const m = b.notes?.find((x) => x.string === n.string);
    if (m) return (m.fret ?? 0) >= (n.fret ?? 0) ? 'h' : 'p';
  }
  return 'h';
}

function noteToken(n, legato) {
  let f;
  if (n.tie) f = '-';
  else if (n.dead) f = 'x';
  else if (n.harmonic) f = `<${n.fret}>`;
  else if (n.ghost) f = `(${n.fret})`;
  else f = String(Math.max(0, n.fret | 0));
  let mods = '';
  if (!n.tie && !n.dead) {
    if (legato) mods += legato;
    if (n.slide) mods += '/';
    if (n.bend) mods += n.bend === 2 ? 'b' : `b${Math.max(1, Math.round(n.bend))}`;
  }
  if (n.vibrato) mods += '~';
  if (n.palmMute) mods += 'm';
  if (n.accent) mods += '!';
  if (n.letRing) mods += 'l';
  return `${n.string}:${f}${mods}`;
}

export const DURATION_VALUES = DURATIONS;
