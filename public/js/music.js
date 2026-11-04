// Core music helpers + buildSong(): turns an imported score (Guitar Pro or
// MusicXML, see importers/) into the structure the renderer and player use.

export const DURATIONS = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25, t: 0.125 };
const TUPLETS = { 3: 2 / 3, 5: 4 / 5, 6: 4 / 6, 7: 4 / 7 };

export const DRUMS = {
  kick: { midi: 36, label: 'K' }, snare: { midi: 38, label: 'SN' }, sidestick: { midi: 37, label: 'SS' },
  hihat: { midi: 42, label: 'HH' }, ohat: { midi: 46, label: 'OH' }, pedal: { midi: 44, label: 'PH' },
  crash: { midi: 49, label: 'CR' }, ride: { midi: 51, label: 'RD' },
  tom1: { midi: 48, label: 'T1' }, tom2: { midi: 45, label: 'T2' }, tom3: { midi: 41, label: 'FT' },
};
export const DRUM_ORDER = ['crash', 'ride', 'ohat', 'hihat', 'tom1', 'tom2', 'snare', 'sidestick', 'tom3', 'kick', 'pedal'];

export const TUNING_PRESETS = {
  standard: 'E2 A2 D3 G3 B3 E4', 'drop-d': 'D2 A2 D3 G3 B3 E4', 'half-down': 'Eb2 Ab2 Db3 Gb3 Bb3 Eb4',
  'full-down': 'D2 G2 C3 F3 A3 D4', 'drop-c': 'C2 G2 C3 F3 A3 D4', 'open-g': 'D2 G2 D3 G3 B3 D4',
  'open-d': 'D2 A2 D3 F#3 A3 D4', dadgad: 'D2 A2 D3 G3 A3 D4', '7-string': 'B1 E2 A2 D3 G3 B3 E4',
  bass: 'E1 A1 D2 G2', 'bass-5': 'B0 E1 A1 D2 G2', 'bass-drop-d': 'D1 A1 D2 G2', ukulele: 'G4 C4 E4 A4',
};

const NOTE_NAMES = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function noteToMidi(name) {
  const m = /^([A-Ga-g])(#|b)?(-?\d)$/.exec(name.trim());
  if (!m) return null;
  return NOTE_NAMES[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (parseInt(m[3], 10) + 1) * 12;
}
export function midiToName(midi, withOctave = true) {
  const n = SHARP_NAMES[((midi % 12) + 12) % 12];
  return withOctave ? n + (Math.floor(midi / 12) - 1) : n;
}
export function parseTuning(str) {
  const s = TUNING_PRESETS[str] || str;
  const midi = s.split(/[\s,]+/).filter(Boolean).map(noteToMidi);
  return midi.some((v) => v == null) ? null : midi;
}
export function durationQuarters(base, dots = 0, tuplet = 0) {
  let q = DURATIONS[base], add = q;
  for (let i = 0; i < dots; i++) { add /= 2; q += add; }
  return tuplet ? q * TUPLETS[tuplet] : q;
}

// GM percussion -> drum names
const GM_DRUMS = {
  35: 'kick', 36: 'kick', 37: 'sidestick', 38: 'snare', 39: 'snare', 40: 'snare',
  41: 'tom3', 43: 'tom3', 45: 'tom2', 47: 'tom2', 48: 'tom1', 50: 'tom1',
  42: 'hihat', 44: 'pedal', 46: 'ohat', 49: 'crash', 52: 'crash', 55: 'crash', 57: 'crash',
  51: 'ride', 53: 'ride', 59: 'ride', 54: 'hihat', 56: 'sidestick', 69: 'hihat', 70: 'hihat', 82: 'hihat',
};
export const gmDrum = (midi) => GM_DRUMS[midi] || null;

// ---- pitch -> string/fret (for sheet music without tab data) -------------
export function assignFrets(midis, tuning, capo = 0, prev = { pos: 3 }, maxFret = 22) {
  const strings = tuning.length;
  const open = tuning.map((m) => m + capo).reverse(); // index 0 = string 1 (highest)
  const lowest = Math.min(...open), highest = Math.max(...open) + maxFret;
  let shifted = false;
  const notes = [...new Set(midis.map((m) => {
    let x = m;
    while (x < lowest) { x += 12; shifted = true; }
    while (x > highest) { x -= 12; shifted = true; }
    return x;
  }))].sort((a, b) => b - a);
  while (notes.length > strings) notes.splice(Math.floor(notes.length / 2), 1);
  const best = { cost: Infinity, res: null };
  const cur = [], used = new Set();
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
      if (cur.length && s < cur[cur.length - 1].string - 1) continue;
      used.add(s); cur.push({ string: s + 1, fret, midi: notes[i] });
      dfs(i + 1);
      cur.pop(); used.delete(s);
    }
  };
  dfs(0);
  if (!best.res) {
    if (notes.length > 1) return assignFrets(notes.filter((_, k) => k !== Math.floor(notes.length / 2)), tuning, capo, prev, maxFret);
    return { notes: [], shifted };
  }
  const fretted = best.res.filter((c) => c.fret > 0);
  if (fretted.length) prev.pos = fretted.reduce((a, c) => a + c.fret, 0) / fretted.length;
  return { notes: best.res, shifted };
}

function restsFor(q) {
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

// ---- model -> song ----------------------------------------------------------
// Returns { song, errors, warnings }  (errors/warnings: [{line, msg}])
export function buildSong(model) {
  const errors = (model.errors || []).map((e) => (typeof e === 'string' ? { line: 0, msg: e } : e));
  const warnings = [];
  const fileWarn = model.warnings?.list ? model.warnings.list() : (model.warnings || []);
  for (const w of fileWarn) warnings.push(typeof w === 'string' ? { line: 0, msg: w } : w);
  const meta = { title: model.meta.title || 'Untitled', artist: model.meta.artist || '', album: model.meta.album || '',
    tempo: model.masterBars[0]?.tempo || model.meta.tempo || 120, time: model.masterBars[0]?.time || [4, 4], offset: 0, sync: [] };
  let tempo = meta.tempo, time = meta.time;
  const masterBars = model.masterBars.map((mb, i) => {
    tempo = mb.tempo || tempo; time = mb.time || time;
    return { index: i, time, tempo, lengthQ: (time[0] * 4) / time[1], section: mb.section, text: mb.text,
      repeatStart: !!mb.repeatStart, repeatEnd: !!mb.repeatEnd, repeatTimes: mb.repeatTimes, ending: mb.ending, line: mb.line };
  });
  const tracks = model.tracks.map((t, ti) => {
    const drums = t.drums || t.instrument === 'drums';
    let tuning = drums ? [] : t.tuning;
    if (!drums && (!tuning || tuning.length < 3 || tuning.length > 8)) {
      tuning = parseTuning(t.instrument === 'bass' ? 'bass' : 'standard');
      if (t.instrument !== 'keys') warnings.push({ line: 0, msg: `${t.name}: no tuning in the file, using ${t.instrument === 'bass' ? 'standard bass' : 'standard'} tuning` });
    }
    const track = { name: t.name || `Track ${ti + 1}`, instrument: drums ? 'drums' : (t.instrument || 'guitar'), tuning, capo: t.capo || 0, volume: 1, pan: 0, bars: [] };
    const hand = { pos: 3 }, lastByMidi = new Map(), lastByString = {};
    masterBars.forEach((mb, bi) => {
      const src = t.bars[bi] || [];
      const beats = [];
      for (const b of src) {
        let notes = [];
        if (drums) {
          for (const n of b.notes || []) {
            const nm = n.drum || gmDrum(n.midi);
            if (!nm) { warnings.push({ line: 0, msg: `${track.name}: drum sound MIDI ${n.midi} is not supported (skipped)` }); continue; }
            if (!notes.some((x) => x.drum === nm)) notes.push({ drum: nm, accent: n.accent, ghost: n.ghost });
          }
        } else {
          const raw = (b.notes || []).map((n) => ({ ...n }));
          for (const n of raw) if (n.string == null && n.midi != null && n.tie && lastByMidi.has(n.midi)) Object.assign(n, lastByMidi.get(n.midi));
          const pitchOnly = raw.filter((n) => n.string == null && n.midi != null);
          notes = raw.filter((n) => n.string != null);
          if (pitchOnly.length) {
            const res = assignFrets(pitchOnly.map((n) => n.midi), tuning, track.capo, hand);
            for (const r of res.notes) {
              const s = pitchOnly.find((n) => n.midi === r.midi) || pitchOnly.find((n) => (n.midi - r.midi) % 12 === 0) || {};
              notes.push({ ...s, string: r.string, fret: r.fret });
            }
          }
          const seen = new Set();
          notes = notes.filter((n) => n.string >= 1 && n.string <= tuning.length && !seen.has(n.string) && seen.add(n.string)).sort((a, c) => a.string - c.string);
          for (const n of notes) { delete n.midi; lastByMidi.set(tuning[tuning.length - n.string] + track.capo + (n.fret || 0), { string: n.string, fret: n.fret }); }
        }
        const dur = { base: b.dur.base, dots: b.dur.dots || 0, tuplet: b.dur.tuplet || 0 };
        beats.push({ dur, q: durationQuarters(dur.base, dur.dots, dur.tuplet), notes: b.rest ? [] : notes, rest: b.rest || !notes.length });
      }
      let sum = beats.reduce((a, b) => a + b.q, 0);
      const line = t.barLines?.[bi] ?? mb.line ?? 0;
      if (beats.length && Math.abs(sum - mb.lengthQ) > 1e-6) {
        warnings.push({ line, msg: `${track.name}, bar ${bi + 1}: notes add up to ${fmtQ(sum)} but ${mb.time[0]}/${mb.time[1]} needs ${fmtQ(mb.lengthQ)}` });
      }
      if (sum < mb.lengthQ - 1e-6 && beats.length) {
        const fill = restsFor(mb.lengthQ - sum).map((r) => ({ ...r, q: durationQuarters(r.dur.base, r.dur.dots) }));
        if (bi === 0 && model.masterBars[0]?.pickup) beats.unshift(...fill); else beats.push(...fill);
      }
      if (!beats.length) beats.push({ dur: { base: 'w', dots: 0, tuplet: 0 }, q: mb.lengthQ, notes: [], rest: true, fullRest: true });
      let pos = 0;
      for (const b of beats) { b.pos = pos; pos += b.q; }
      track.bars.push({ beats, line, dir: {} });
    });
    // pitches, ties and hammer/pull direction
    const flat = [];
    track.bars.forEach((bar) => bar.beats.forEach((b) => flat.push(b)));
    flat.forEach((beat, k) => {
      for (const n of beat.notes) {
        if (n.drum) { n.midi = DRUMS[n.drum].midi; continue; }
        if (n.tie) {
          const p = lastByString[n.string];
          if (p) { n.fret = p.fret; n.tiedFrom = p; }
        }
        n.midi = tuning[tuning.length - n.string] + track.capo + (n.fret || 0) + (n.harmonic ? harmonicOffset(n.fret) - n.fret : 0);
        lastByString[n.string] = n;
        if (n.legato) {
          let next = null;
          for (let j = k + 1; j < flat.length && !next; j++) next = flat[j].notes.find((m) => m.string === n.string);
          if (next && (next.fret ?? 0) < (n.fret ?? 0)) n.pull = true; else n.hammer = true;
        }
      }
    });
    return track;
  });
  return { song: { meta, tracks, masterBars }, errors, warnings };
}
function fmtQ(q) { return (Math.round(q * 1000) / 1000) + ' quarter' + (q === 1 ? '' : 's'); }
function harmonicOffset(fret) {
  const map = { 12: 12, 7: 19, 5: 24, 19: 19, 24: 24, 4: 28, 9: 28, 3: 31 };
  return map[fret] ?? fret;
}
