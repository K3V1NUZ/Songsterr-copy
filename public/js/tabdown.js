// TabDown parser — the plain-text tab format used by Fretline.
// Works in the browser and in Node (pure ES module, no dependencies).
// Full spec: docs/TABDOWN_SPEC.md

export const DURATIONS = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25, t: 0.125 };
const TUPLETS = { 3: 2 / 3, 5: 4 / 5, 6: 4 / 6, 7: 4 / 7 };

export const DRUMS = {
  kick:      { alias: ['k', 'bd'],  midi: 36, label: 'K'  },
  snare:     { alias: ['sn', 'sd'], midi: 38, label: 'SN' },
  sidestick: { alias: ['ss'],       midi: 37, label: 'SS' },
  hihat:     { alias: ['hh'],       midi: 42, label: 'HH' },
  ohat:      { alias: ['oh'],       midi: 46, label: 'OH' },
  pedal:     { alias: ['ph'],       midi: 44, label: 'PH' },
  crash:     { alias: ['cr'],       midi: 49, label: 'CR' },
  ride:      { alias: ['rd'],       midi: 51, label: 'RD' },
  tom1:      { alias: ['t1'],       midi: 48, label: 'T1' },
  tom2:      { alias: ['t2'],       midi: 45, label: 'T2' },
  tom3:      { alias: ['t3', 'ft'], midi: 41, label: 'FT' },
};
const DRUM_LOOKUP = {};
for (const [name, d] of Object.entries(DRUMS)) {
  DRUM_LOOKUP[name] = name;
  d.alias.forEach((a) => (DRUM_LOOKUP[a] = name));
}
// Top-to-bottom order used when drawing drum tracks.
export const DRUM_ORDER = ['crash', 'ride', 'ohat', 'hihat', 'tom1', 'tom2', 'snare', 'sidestick', 'tom3', 'kick', 'pedal'];

export const TUNING_PRESETS = {
  standard: 'E2 A2 D3 G3 B3 E4',
  'drop-d': 'D2 A2 D3 G3 B3 E4',
  'half-down': 'Eb2 Ab2 Db3 Gb3 Bb3 Eb4',
  'full-down': 'D2 G2 C3 F3 A3 D4',
  'drop-c': 'C2 G2 C3 F3 A3 D4',
  'open-g': 'D2 G2 D3 G3 B3 D4',
  'open-d': 'D2 A2 D3 F#3 A3 D4',
  dadgad: 'D2 A2 D3 G3 A3 D4',
  '7-string': 'B1 E2 A2 D3 G3 B3 E4',
  bass: 'E1 A1 D2 G2',
  'bass-5': 'B0 E1 A1 D2 G2',
  'bass-drop-d': 'D1 A1 D2 G2',
  ukulele: 'G4 C4 E4 A4',
};
const DEFAULT_TUNING = { guitar: 'standard', bass: 'bass', ukulele: 'ukulele' };

export const INSTRUMENTS = ['guitar', 'acoustic', 'electric', 'distortion', 'bass', 'ukulele', 'banjo', 'keys', 'drums'];

const NOTE_NAMES = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteToMidi(name) {
  const m = /^([A-Ga-g])(#|b|♯|♭)?(-?\d)$/.exec(name.trim());
  if (!m) return null;
  let v = NOTE_NAMES[m[1].toLowerCase()];
  if (m[2] === '#' || m[2] === '♯') v++;
  if (m[2] === 'b' || m[2] === '♭') v--;
  return v + (parseInt(m[3], 10) + 1) * 12;
}
export function midiToName(midi, withOctave = true) {
  const n = SHARP_NAMES[((midi % 12) + 12) % 12];
  return withOctave ? n + (Math.floor(midi / 12) - 1) : n;
}

export function parseTuning(str, instrument = 'guitar') {
  let s = (str || '').trim().toLowerCase();
  if (!s) s = DEFAULT_TUNING[instrument] || 'standard';
  if (TUNING_PRESETS[s]) s = TUNING_PRESETS[s];
  const parts = s.split(/[\s,]+/).filter(Boolean);
  const midi = parts.map(noteToMidi);
  if (midi.some((v) => v == null)) return null;
  return midi; // low string first
}

export function durationQuarters(base, dots, tuplet) {
  let q = DURATIONS[base];
  let add = q;
  for (let i = 0; i < dots; i++) { add /= 2; q += add; }
  if (tuplet) q *= TUPLETS[tuplet];
  return q;
}

const HEADER_KEYS = new Set(['title', 'artist', 'album', 'year', 'tempo', 'time', 'audio', 'offset', 'sync',
  'key', 'source', 'tabber', 'comment', 'genre', 'difficulty']);
const TRACK_KEYS = new Set(['track', 'instrument', 'tuning', 'capo', 'volume', 'pan', 'color']);

function parseTimeSig(s) {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(s).trim());
  if (!m) return null;
  const n = +m[1], d = +m[2];
  if (!n || ![1, 2, 4, 8, 16, 32].includes(d)) return null;
  return [n, d];
}

export function parseSync(str) {
  // "1@2.35, 17@40.1" -> [{bar:1,time:2.35}, ...]
  const out = [];
  for (const part of String(str).split(/[\s,;]+/).filter(Boolean)) {
    const m = /^(\d+)@(-?\d+(?:\.\d+)?)$/.exec(part);
    if (!m) return null;
    out.push({ bar: +m[1], time: +m[2] });
  }
  return out;
}

// --- note parsing -------------------------------------------------------
const MOD_RE = /^(h|p|\/|\\|~|m|!|l|b(\d+(?:\.\d+)?)?)/;

function parseStringNote(tok, track, ctx) {
  const m = /^(\d+):(.*)$/.exec(tok);
  if (!m) return null;
  const string = +m[1];
  let rest = m[2];
  const note = { string };
  let fm;
  if ((fm = /^(\d+)/.exec(rest))) { note.fret = +fm[1]; }
  else if ((fm = /^x/.exec(rest))) { note.dead = true; note.fret = 0; }
  else if ((fm = /^-/.exec(rest))) { note.tie = true; }
  else if ((fm = /^<(\d+)>/.exec(rest))) { note.fret = +fm[1]; note.harmonic = true; }
  else if ((fm = /^\((\d+)\)/.exec(rest))) { note.fret = +fm[1]; note.ghost = true; }
  else { ctx.error(`Bad fret in "${tok}" (expected e.g. 3:5, 3:x, 3:-, 3:<12>, 3:(5))`); return 'bad'; }
  rest = rest.slice(fm[0].length);
  while (rest.length) {
    const mm = MOD_RE.exec(rest);
    if (!mm) { ctx.error(`Unknown technique "${rest}" in "${tok}"`); return 'bad'; }
    const c = mm[1][0];
    if (c === 'h') note.hammer = true;
    else if (c === 'p') note.pull = true;
    else if (c === '/' || c === '\\') note.slide = true;
    else if (c === '~') note.vibrato = true;
    else if (c === 'm') note.palmMute = true;
    else if (c === '!') note.accent = true;
    else if (c === 'l') note.letRing = true;
    else if (c === 'b') note.bend = mm[2] ? +mm[2] : 2; // semitones, default full (2)
    rest = rest.slice(mm[0].length);
  }
  if (string < 1 || string > track.tuning.length) {
    ctx.error(`String ${string} does not exist on "${track.name}" (${track.tuning.length} strings)`);
    return 'bad';
  }
  if (note.fret != null && note.fret > 36) ctx.warn(`Fret ${note.fret} looks too high in "${tok}"`);
  return note;
}

function parseDrumNote(tok, ctx) {
  let t = tok, accent = false, ghost = false;
  if (t.endsWith('!')) { accent = true; t = t.slice(0, -1); }
  const g = /^\((.+)\)$/.exec(t);
  if (g) { ghost = true; t = g[1]; }
  const name = DRUM_LOOKUP[t.toLowerCase()];
  if (!name) return null;
  return { drum: name, accent, ghost };
}

// --- main parser --------------------------------------------------------
export function parseTabDown(text) {
  const errors = [], warnings = [];
  const meta = { title: 'Untitled', artist: '', tempo: 120, time: [4, 4], offset: 0, sync: [] };
  const tracks = [];
  let track = null;
  let lineNo = 0;
  const ctx = {
    error: (msg) => errors.push({ line: lineNo, msg }),
    warn: (msg) => warnings.push({ line: lineNo, msg }),
  };

  // per-track bar building state
  let bar = null, pendingRepeatStart = false, dur = { base: 'q', dots: 0, tuplet: 0 };
  const newBar = () => ({ beats: [], line: lineNo, dir: {} });
  const flushBar = (force) => {
    if (!track) return;
    const empty = bar.beats.length === 0 && Object.keys(bar.dir).length === 0;
    if (empty && !force) return;
    if (pendingRepeatStart) { bar.dir.repeatStart = true; pendingRepeatStart = false; }
    track.bars.push(bar);
    bar = newBar();
  };

  const startTrack = (name) => {
    if (track) flushBar();
    track = { name: name || `Track ${tracks.length + 1}`, instrument: 'guitar', tuningText: '', tuning: null,
      capo: 0, volume: 1, pan: 0, bars: [], line: lineNo };
    tracks.push(track);
    bar = newBar(); pendingRepeatStart = false; dur = { base: 'q', dots: 0, tuplet: 0 };
  };
  const ensureTuning = () => {
    if (track.tuning) return;
    if (track.instrument === 'drums') { track.tuning = []; return; }
    const t = parseTuning(track.tuningText, track.instrument);
    if (!t) { ctx.error(`Bad tuning "${track.tuningText}"`); track.tuning = parseTuning('standard'); }
    else track.tuning = t;
  };

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let li = 0; li < lines.length; li++) {
    lineNo = li + 1;
    let line = lines[li];
    // comments: '#' at line start or preceded by whitespace
    line = line.replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;

    const hm = /^([a-zA-Z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (hm && (HEADER_KEYS.has(hm[1].toLowerCase()) || TRACK_KEYS.has(hm[1].toLowerCase()))) {
      const key = hm[1].toLowerCase(), val = hm[2].trim();
      if (key === 'track') { startTrack(val); continue; }
      if (TRACK_KEYS.has(key)) {
        if (!track) { ctx.error(`"${key}:" must come after a "track:" line`); continue; }
        if (key === 'instrument') {
          const v = val.toLowerCase();
          if (!INSTRUMENTS.includes(v)) ctx.warn(`Unknown instrument "${val}", using guitar sound`);
          track.instrument = v;
        } else if (key === 'tuning') track.tuningText = val;
        else if (key === 'capo') track.capo = parseInt(val, 10) || 0;
        else if (key === 'volume') track.volume = Math.max(0, Math.min(1, parseFloat(val)));
        else if (key === 'pan') track.pan = Math.max(-1, Math.min(1, parseFloat(val) || 0));
        else track[key] = val;
        continue;
      }
      // song header (allowed anywhere, but conventionally at the top)
      if (key === 'tempo') { const t = parseFloat(val); if (t > 0) meta.tempo = t; else ctx.error(`Bad tempo "${val}"`); }
      else if (key === 'time') { const t = parseTimeSig(val); if (t) meta.time = t; else ctx.error(`Bad time signature "${val}"`); }
      else if (key === 'offset') { const o = parseFloat(val); if (isFinite(o)) meta.offset = o; else ctx.error(`Bad offset "${val}"`); }
      else if (key === 'sync') { const s = parseSync(val); if (s) meta.sync.push(...s); else ctx.error(`Bad sync "${val}" (expected e.g. 1@2.35, 9@18.4)`); }
      else meta[key] = val;
      continue;
    }

    // body line
    if (!track) startTrack('Guitar');
    ensureTuning();
    const isDrums = track.instrument === 'drums';
    // tokenise: {directives}, [chords], bar lines, plain tokens
    const toks = [];
    const re = /\{[^}]*\}|\[|\]|:\|:|:\|(?:x\d+)?|\|:|\|\||\||[^\s[\]{}|]+/g;
    let mt;
    while ((mt = re.exec(line))) toks.push(mt[0]);

    let chord = null;
    for (const tok of toks) {
      if (tok === '[') { if (chord) ctx.error('Nested "["'); chord = []; continue; }
      if (tok === ']') {
        if (!chord) { ctx.error('"]" without "["'); continue; }
        bar.beats.push({ dur: { ...dur }, q: durationQuarters(dur.base, dur.dots, dur.tuplet), notes: chord, line: lineNo });
        chord = null; continue;
      }
      if (tok[0] === '{') {
        const body = tok.slice(1, -1).trim();
        const sp = body.indexOf(' ');
        const name = (sp < 0 ? body : body.slice(0, sp)).toLowerCase();
        const arg = sp < 0 ? '' : body.slice(sp + 1).trim();
        if (name === 'tempo') { const t = parseFloat(arg); if (t > 0) bar.dir.tempo = t; else ctx.error(`Bad {tempo ${arg}}`); }
        else if (name === 'time') { const t = parseTimeSig(arg); if (t) bar.dir.time = t; else ctx.error(`Bad {time ${arg}}`); }
        else if (name === 'section') bar.dir.section = arg;
        else if (name === 'ending') {
          const e = arg.split(/[\s,]+/).map(Number).filter((n) => n > 0);
          if (e.length) bar.dir.ending = e; else ctx.error(`Bad {ending ${arg}}`);
        } else if (name === 'text') bar.dir.text = arg;
        else ctx.warn(`Unknown directive {${name}}`);
        continue;
      }
      // a bar line with no notes before it (e.g. at line start) just separates; directives carry over
      if (tok === '|' || tok === '||') { if (chord) { ctx.error('Bar line inside [chord]'); chord = null; } if (bar.beats.length) flushBar(); continue; }
      if (tok === '|:') { if (bar.beats.length) flushBar(); pendingRepeatStart = true; continue; }
      if (tok.startsWith(':|')) {
        const times = tok === ':|:' ? 2 : parseInt(tok.slice(3), 10) || 2;
        if (bar.beats.length === 0 && track.bars.length && !pendingRepeatStart) {
          // ":|" right after a "|" -> applies to previous bar
          const prev = track.bars[track.bars.length - 1];
          prev.dir.repeatEnd = true; prev.dir.repeatTimes = times;
        } else { bar.dir.repeatEnd = true; bar.dir.repeatTimes = times; flushBar(true); }
        if (tok === ':|:') pendingRepeatStart = true;
        continue;
      }
      const dm = /^(w|h|q|e|s|t)(\.{0,2})(3|5|6|7)?$/.exec(tok);
      if (dm) { dur = { base: dm[1], dots: dm[2].length, tuplet: dm[3] ? +dm[3] : 0 }; continue; }
      if (tok === 'r') {
        if (chord) { ctx.error('Rest "r" inside [chord]'); continue; }
        bar.beats.push({ dur: { ...dur }, q: durationQuarters(dur.base, dur.dots, dur.tuplet), notes: [], rest: true, line: lineNo });
        continue;
      }
      let note = null;
      if (isDrums) note = parseDrumNote(tok, ctx);
      else note = parseStringNote(tok, track, ctx);
      if (note === 'bad') continue;
      if (!note) {
        ctx.error(isDrums ? `Unknown drum "${tok}" (use ${Object.keys(DRUMS).join(', ')})`
          : `Unknown token "${tok}" (notes are string:fret, e.g. 6:3)`);
        continue;
      }
      if (chord) chord.push(note);
      else bar.beats.push({ dur: { ...dur }, q: durationQuarters(dur.base, dur.dots, dur.tuplet), notes: [note], line: lineNo });
    }
    if (chord) { ctx.error('Unclosed "[" (a chord must be on one line)'); }
  }
  if (track) flushBar();
  if (!tracks.length) errors.push({ line: 0, msg: 'No tracks/notes found' });
  for (const t of tracks) { if (!t.tuning) { track = t; ensureTuning(); } }

  const song = { meta, tracks, masterBars: [] };
  buildMasterBars(song, ctx, warnings);
  resolvePitches(song);
  return { song, errors, warnings };
}

function buildMasterBars(song, ctx, warnings) {
  const n = Math.max(0, ...song.tracks.map((t) => t.bars.length));
  const counts = new Set(song.tracks.map((t) => t.bars.length));
  if (counts.size > 1) {
    warnings.push({ line: 0, msg: 'Tracks have different bar counts: ' +
      song.tracks.map((t) => `${t.name}=${t.bars.length}`).join(', ') + ' (shorter tracks are padded with rests)' });
  }
  let time = song.meta.time, tempo = song.meta.tempo;
  for (let i = 0; i < n; i++) {
    const mb = { index: i, time, tempo };
    for (const t of song.tracks) {
      const d = t.bars[i]?.dir;
      if (!d) continue;
      if (d.time) mb.time = d.time;
      if (d.tempo) mb.tempo = d.tempo;
      for (const k of ['section', 'repeatStart', 'repeatEnd', 'repeatTimes', 'ending', 'text']) if (d[k] != null && mb[k] == null) mb[k] = d[k];
    }
    time = mb.time; tempo = mb.tempo;
    mb.lengthQ = (mb.time[0] * 4) / mb.time[1];
    song.masterBars.push(mb);
  }
  // pad + check bar lengths
  for (const t of song.tracks) {
    while (t.bars.length < n) t.bars.push({ beats: [], dir: {}, padded: true });
    t.bars.forEach((b, i) => {
      const mb = song.masterBars[i];
      let pos = 0;
      for (const beat of b.beats) { beat.pos = pos; pos += beat.q; }
      b.sumQ = pos;
      if (!b.padded && b.beats.length && Math.abs(pos - mb.lengthQ) > 1e-6) {
        warnings.push({ line: b.line, msg: `${t.name}, bar ${i + 1}: has ${fmtQ(pos)} beats but ${mb.time[0]}/${mb.time[1]} needs ${fmtQ(mb.lengthQ)}` });
      }
      if (!b.beats.length) { // empty bar = whole-bar rest
        b.beats.push({ dur: { base: 'w', dots: 0, tuplet: 0 }, q: mb.lengthQ, pos: 0, notes: [], rest: true, fullRest: true });
        b.sumQ = mb.lengthQ;
      }
    });
  }
}
function fmtQ(q) { return (Math.round(q * 1000) / 1000) + ' quarter' + (q === 1 ? '' : 's'); }

function resolvePitches(song) {
  for (const t of song.tracks) {
    const strings = t.tuning.length;
    const last = {}; // string -> previous note (for ties)
    for (const b of t.bars) for (const beat of b.beats) for (const note of beat.notes) {
      if (note.drum) { note.midi = DRUMS[note.drum].midi; continue; }
      const open = t.tuning[strings - note.string];
      if (note.tie) {
        const p = last[note.string];
        if (p) { note.fret = p.fret; note.tiedFrom = p; } else note.fret = 0;
      }
      note.midi = open + t.capo + (note.fret || 0) + (note.harmonic ? harmonicOffset(note.fret) - note.fret : 0);
      last[note.string] = note;
    }
  }
}
function harmonicOffset(fret) {
  const map = { 12: 12, 7: 19, 5: 24, 19: 19, 24: 24, 4: 28, 9: 28, 3: 31 };
  return map[fret] ?? fret;
}

// --- writing helpers (used by the sync tool to update header lines) ------
export function setHeaderLine(text, key, value) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const re = new RegExp(`^\\s*${key}\\s*:`, 'i');
  const idx = lines.findIndex((l) => re.test(l));
  const firstTrack = lines.findIndex((l) => /^\s*track\s*:/i.test(l));
  // remove duplicates (e.g. multiple sync: lines) beyond the first
  if (value == null) return lines.filter((l) => !re.test(l)).join('\n');
  const newLine = `${key}: ${value}`;
  if (idx >= 0 && (firstTrack < 0 || idx < firstTrack)) {
    lines[idx] = newLine;
    return lines.filter((l, i) => i === idx || !re.test(l)).join('\n');
  }
  // insert after the last header line before the first track
  let insertAt = 0;
  const end = firstTrack < 0 ? lines.length : firstTrack;
  for (let i = 0; i < end; i++) if (/^\s*[a-zA-Z][\w-]*\s*:/.test(lines[i])) insertAt = i + 1;
  lines.splice(insertAt, 0, newLine);
  return lines.join('\n');
}

export function formatSync(anchors) {
  return anchors.slice().sort((a, b) => a.bar - b.bar).map((a) => `${a.bar}@${a.time.toFixed(3)}`).join(', ');
}
