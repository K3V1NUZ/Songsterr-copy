// Guitar Pro importer:
//   .gp3 / .gp4 / .gp5  binary formats (Guitar Pro 3-5)
//   .gpx                Guitar Pro 6 (BCFZ-compressed container with score.gpif XML)
//   .gp                 Guitar Pro 7/8 (ZIP with Content/score.gpif)
// Produces the shared import model (see model.js).
import { parseXML, decodeText } from './xml.js';
import { readZipFile } from './zip.js';
import { durFromValue, instrumentFromProgram, Warnings } from './model.js';

// =========================================================================
// GP3 / GP4 / GP5 binary
// =========================================================================
class Reader {
  constructor(bytes) {
    this.b = bytes; this.p = 0;
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    try { this.dec = new TextDecoder('windows-1252'); } catch { this.dec = new TextDecoder('latin1'); }
  }
  need(n) { if (this.p + n > this.b.length) throw new Error(`Unexpected end of file at byte ${this.p}`); }
  u8() { this.need(1); return this.b[this.p++]; }
  i8() { this.need(1); return this.dv.getInt8(this.p++); }
  bool() { return this.u8() !== 0; }
  i16() { this.need(2); const v = this.dv.getInt16(this.p, true); this.p += 2; return v; }
  i32() { this.need(4); const v = this.dv.getInt32(this.p, true); this.p += 4; return v; }
  skip(n) { this.need(n); this.p += n; }
  str(n) { this.need(n); const s = this.dec.decode(this.b.subarray(this.p, this.p + n)); this.p += n; return s; }
  // length byte, then `size` bytes (string is the first `length` of them)
  byteSizeString(size) { const len = this.u8(); const s = this.str(size); return s.slice(0, Math.min(len, size)); }
  intSizeString() { const n = this.i32(); return n > 0 ? this.str(n) : ''; }
  intByteSizeString() { const n = this.i32(); return n > 0 ? this.byteSizeString(n - 1) : (this.u8(), ''); }
}

export function isGPBinary(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(1, 25));
  return /^FICHIER GUITAR PRO v[345]/.test(head);
}

export function parseGPBinary(bytes) {
  const r = new Reader(bytes);
  const versionStr = r.byteSizeString(30);
  const vm = /v(\d)\.(\d\d)/.exec(versionStr);
  if (!vm) throw new Error(`Unknown Guitar Pro version "${versionStr}"`);
  const major = +vm[1], minor = +vm[2];
  const v = major * 100 + minor; // 300, 400, 406, 500, 510
  const warn = new Warnings();

  // --- song info ---
  const info = {};
  info.title = r.intByteSizeString(); info.subtitle = r.intByteSizeString();
  info.artist = r.intByteSizeString(); info.album = r.intByteSizeString();
  info.words = r.intByteSizeString();
  if (v >= 500) info.music = r.intByteSizeString();
  info.copyright = r.intByteSizeString(); info.tab = r.intByteSizeString(); info.instructions = r.intByteSizeString();
  const notices = r.i32(); for (let i = 0; i < notices; i++) r.intByteSizeString();

  if (v < 500) r.bool(); // triplet feel
  if (v >= 400) { r.i32(); for (let i = 0; i < 5; i++) { r.i32(); r.intSizeString(); } } // lyrics
  if (v > 500) r.skip(19); // RSE master effect
  if (v >= 500) { // page setup
    r.skip(30);
    for (let i = 0; i < 10; i++) r.intByteSizeString();
    r.intByteSizeString(); // tempo name
  }
  const tempo = r.i32();
  if (v > 500) r.bool(); // hide tempo
  if (v >= 500) { r.i8(); r.i32(); } else { r.i32(); if (v >= 400) r.i8(); } // key (+octave)
  const programs = [];
  for (let i = 0; i < 64; i++) { programs.push(r.i32()); r.skip(6); r.skip(2); }
  if (v >= 500) { r.skip(38); r.i32(); } // directions, master reverb
  const measureCount = r.i32();
  const trackCount = r.i32();
  if (measureCount < 0 || measureCount > 10000 || trackCount < 1 || trackCount > 128) throw new Error('This does not look like a valid Guitar Pro file');

  // --- measure headers ---
  const headers = [];
  for (let i = 0; i < measureCount; i++) {
    const prev = headers[i - 1];
    if (v >= 500 && i > 0) r.skip(1);
    const flags = r.u8();
    const h = { time: prev ? [...prev.time] : [4, 4], repeatStart: !!(flags & 0x04), alt: 0 };
    if (flags & 0x01) h.time[0] = r.i8();
    if (flags & 0x02) h.time[1] = r.i8();
    if (flags & 0x08) { const raw = r.i8(); h.repeatEnd = true; h.repeatTimes = v >= 500 ? Math.max(2, raw) : raw + 1; }
    const readAlt = () => {
      const val = r.u8();
      if (v >= 500) return val;
      let existing = 0;
      for (let k = headers.length - 1; k >= 0; k--) { if (headers[k].repeatStart) break; existing |= headers[k].alt; }
      return ((1 << val) - 1) ^ existing;
    };
    if (v < 500 && (flags & 0x10)) h.alt = readAlt();
    if (flags & 0x20) { h.section = r.intByteSizeString().trim(); r.skip(4); }
    if (flags & 0x40) { r.i8(); r.i8(); }
    if (v >= 500) {
      if (flags & 0x10) h.alt = readAlt();
      if (flags & 0x03) r.skip(4);
      if (!(flags & 0x10)) r.skip(1);
      r.u8(); // triplet feel
    }
    headers.push(h);
  }

  // --- tracks ---
  const tracks = [];
  for (let i = 0; i < trackCount; i++) {
    if (v >= 500 && (i === 0 || v === 500)) r.skip(1);
    const flags = r.u8();
    const name = r.byteSizeString(40).trim();
    const stringCount = r.i32();
    const tun = [];
    for (let s = 0; s < 7; s++) { const t = r.i32(); if (s < stringCount) tun.push(t); }
    r.i32(); // port
    const channel = r.i32() - 1; r.i32();
    r.i32(); // fret count
    const capo = r.i32();
    r.skip(4); // color
    if (v >= 500) {
      r.i16(); r.u8(); r.u8(); r.u8();
      r.skip(12); r.skip(12);
      r.skip(12); if (v === 500) { r.skip(3); } else r.skip(4); // RSE instrument
      if (v > 500) { r.skip(4); r.intByteSizeString(); r.intByteSizeString(); }
    }
    const drums = !!(flags & 0x01) || channel === 9;
    const program = programs[channel] ?? 25;
    const tuning = tun.slice().reverse(); // file lists string 1 (highest) first
    tracks.push({
      name: name || `Track ${i + 1}`, tuning: drums ? [] : tuning, capo: drums ? 0 : Math.max(0, capo), drums,
      instrument: instrumentFromProgram(program, { strings: stringCount, name, drums, lowest: Math.min(...tuning) }),
      strings: stringCount, bars: [],
    });
  }
  if (v >= 500) r.skip(v === 500 ? 2 : 1);

  // --- measures ---
  const tempoAt = [];
  for (let m = 0; m < measureCount; m++) {
    for (let ti = 0; ti < trackCount; ti++) {
      const track = tracks[ti];
      const voices = [];
      for (let vi = 0; vi < (v >= 500 ? 2 : 1); vi++) {
        const beats = [];
        const count = r.i32();
        if (count < 0 || count > 1024) throw new Error(`Corrupt beat count in bar ${m + 1}`);
        for (let b = 0; b < count; b++) {
          const beat = readBeat(r, v, track, warn);
          if (beat.tempo != null && tempoAt[m] == null) tempoAt[m] = beat.tempo;
          if (!beat.empty) beats.push(beat);
        }
        voices.push(beats);
      }
      if (v >= 500) r.u8(); // line break
      // pick the voice with more notes (voice 1 normally)
      const score = (vs) => vs.reduce((a, b) => a + (b.rest ? 0 : b.notes.length), 0);
      let chosen = voices[0];
      if (voices[1] && score(voices[1]) > score(voices[0])) { chosen = voices[1]; warn.add(`${track.name}: used the second voice where the first was empty`); }
      track.bars.push(chosen);
    }
  }

  const masterBars = headers.map((h, i) => {
    const mb = { time: h.time, repeatStart: h.repeatStart, repeatEnd: h.repeatEnd, repeatTimes: h.repeatTimes, section: h.section || undefined };
    if (h.alt) mb.ending = [0, 1, 2, 3, 4, 5, 6, 7].filter((k) => h.alt & (1 << k)).map((k) => k + 1);
    if (tempoAt[i] != null) mb.tempo = tempoAt[i];
    return mb;
  });
  let curTempo = tempo;
  for (const mb of masterBars) { if (mb.tempo) curTempo = mb.tempo; else mb.tempo = curTempo; }
  return {
    format: `Guitar Pro ${major}`,
    meta: { title: info.title || info.subtitle, artist: info.artist, album: info.album, tempo, time: masterBars[0]?.time || [4, 4] },
    masterBars, tracks, warnings: warn,
  };
}

function readBeat(r, v, track, warn) {
  const flags = r.u8();
  let status = 1;
  if (flags & 0x40) status = r.u8();
  const value = 1 << (r.i8() + 2);
  const dotted = !!(flags & 0x01);
  let tupletEnters = 0, tupletTimes = 0;
  if (flags & 0x20) {
    const t = r.i32();
    tupletEnters = t;
    tupletTimes = { 3: 2, 5: 4, 6: 4, 7: 4, 9: 8, 10: 8, 11: 8, 12: 8, 13: 8 }[t] || t;
  }
  if (flags & 0x02) readChord(r, v);
  if (flags & 0x04) r.intByteSizeString(); // text
  let beatFx = {};
  if (flags & 0x08) beatFx = readBeatEffects(r, v);
  let tempo = null;
  if (flags & 0x10) tempo = readMixTable(r, v);
  const stringFlags = r.u8();
  const notes = [];
  for (let s = 1; s <= track.strings; s++) {
    if (stringFlags & (1 << (7 - s))) {
      const n = readNote(r, v, s);
      if (beatFx.vibrato) n.vibrato = true;
      if (beatFx.harmonic) n.harmonic = true;
      notes.push(n);
    }
  }
  if (v >= 500) { const f2 = r.i16(); if (f2 & 0x800) r.u8(); }
  const dur = durFromValue(value, dotted ? 1 : 0, tupletEnters, tupletTimes, warn);
  const beat = { dur, rest: status === 2 || !notes.length, notes: [], empty: status === 0, tempo };
  for (const n of notes) {
    if (track.drums) { if (!n.dead) beat.notes.push({ midi: n.fret, accent: n.accent, ghost: n.ghost }); }
    else beat.notes.push(n);
  }
  if (!beat.notes.length) beat.rest = true;
  return beat;
}

function readChord(r, v) {
  const newFormat = r.u8();
  if (!newFormat) { r.intByteSizeString(); const first = r.i32(); if (first) r.skip(24); }
  else r.skip(v >= 400 ? 106 : 124);
}

function readBeatEffects(r, v) {
  const fx = {};
  if (v < 400) {
    const f1 = r.u8();
    if (f1 & 0x03) fx.vibrato = true;
    if (f1 & 0x20) { r.u8(); r.i32(); }
    if (f1 & 0x40) r.skip(2);
    if (f1 & 0x04) fx.harmonic = true;
    return fx;
  }
  const f1 = r.u8(), f2 = r.u8();
  if (f1 & 0x02) fx.vibrato = true;
  if (f1 & 0x20) r.i8();
  if (f2 & 0x04) readBend(r);
  if (f1 & 0x40) r.skip(2);
  if (f2 & 0x02) r.i8();
  return fx;
}

function readMixTable(r, v) {
  r.i8(); // instrument
  if (v >= 500) { r.skip(12); if (v === 500) r.skip(3); else r.skip(4); if (v === 500) r.skip(1); }
  const vals = [];
  for (let i = 0; i < 6; i++) vals.push(r.i8()); // volume balance chorus reverb phaser tremolo
  if (v >= 500) r.intByteSizeString(); // tempo name
  const tempo = r.i32();
  for (const x of vals) if (x >= 0) r.i8();
  if (tempo >= 0) { r.i8(); if (v > 500) r.bool(); }
  if (v >= 400) r.i8(); // apply-to-all flags
  if (v >= 500) { r.i8(); if (v > 500) { r.intByteSizeString(); r.intByteSizeString(); } }
  return tempo > 0 ? tempo : null;
}

function readBend(r) {
  r.i8(); r.i32();
  const n = r.i32();
  let max = 0;
  for (let i = 0; i < n; i++) { r.i32(); max = Math.max(max, r.i32()); r.bool(); }
  return max; // 50 = one semitone
}

function readNote(r, v, string) {
  const flags = r.u8();
  const n = { string, fret: 0 };
  if (flags & 0x04) n.ghost = true;
  if (flags & 0x40 || flags & 0x02) n.accent = true;
  let type = 1;
  if (flags & 0x20) type = r.u8();
  if (v < 500 && (flags & 0x01)) { r.i8(); r.i8(); }
  if (flags & 0x10) r.i8(); // velocity
  if (flags & 0x20) n.fret = Math.max(0, r.i8());
  if (flags & 0x80) { r.i8(); r.i8(); }
  if (v >= 500) { if (flags & 0x01) r.skip(8); r.u8(); }
  if (type === 2) n.tie = true;
  if (type === 3) n.dead = true;
  if (flags & 0x08) readNoteEffects(r, v, n);
  return n;
}

function readNoteEffects(r, v, n) {
  if (v < 400) {
    const f = r.u8();
    if (f & 0x02) n.legato = true;
    if (f & 0x08) n.letRing = true;
    if (f & 0x04) n.slide = true;
    if (f & 0x01) { const b = readBend(r); if (b > 0) n.bend = Math.max(1, Math.round(b / 50)); }
    if (f & 0x10) r.skip(4);
    return;
  }
  const f1 = r.u8(), f2 = r.u8();
  if (f1 & 0x02) n.legato = true;
  if (f1 & 0x08) n.letRing = true;
  if (f2 & 0x02) n.palmMute = true;
  if (f2 & 0x40) n.vibrato = true;
  if (f1 & 0x01) { const b = readBend(r); if (b > 0) n.bend = Math.max(1, Math.round(b / 50)); }
  if (f1 & 0x10) r.skip(v >= 500 ? 5 : 4); // grace note (ignored)
  if (f2 & 0x04) r.i8(); // tremolo picking
  if (f2 & 0x08) { const s = r.u8(); if (v < 500 ? s > 0 && s < 3 : s & 0x03) n.slide = true; }
  if (f2 & 0x10) {
    const ht = r.i8();
    if (ht === 1) n.harmonic = true;
    if (v >= 500) { if (ht === 2) r.skip(3); else if (ht === 3) r.skip(1); }
  }
  if (f2 & 0x20) r.skip(2); // trill
}

// =========================================================================
// GP6 .gpx container (BCFZ / BCFS)
// =========================================================================
export function isGPX(bytes) {
  const h = String.fromCharCode(...bytes.subarray(0, 4));
  return h === 'BCFZ' || h === 'BCFS';
}

export function bcfzDecompress(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const expected = dv.getInt32(4, true);
  const out = new Uint8Array(expected);
  let len = 0;
  let pos = 8 * 8; // bit position (after "BCFZ" + length)
  const total = bytes.length * 8;
  const bit = () => { const v = (bytes[pos >> 3] >> (7 - (pos & 7))) & 1; pos++; return v; };
  const bits = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | bit(); return v; };
  const bitsRev = (n) => { let v = 0; for (let i = 0; i < n; i++) v |= bit() << i; return v; };
  while (len < expected && pos < total) {
    if (bit() === 1) {
      const word = bits(4);
      const offset = bitsRev(word);
      const size = bitsRev(word);
      const src = len - offset;
      const n = Math.min(offset, size);
      for (let i = 0; i < n && len < expected; i++) out[len++] = out[src + i];
    } else {
      const size = bitsRev(2);
      for (let i = 0; i < size && len < expected; i++) out[len++] = bits(8);
    }
  }
  return out.subarray(0, len);
}

export function bcfsFiles(data) {
  // data: the filesystem bytes *after* the "BCFS" header
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const SECTOR = 0x1000;
  const files = {};
  const int = (o) => (o + 4 <= data.length ? dv.getInt32(o, true) : 0);
  const str = (o, max) => { let s = ''; for (let i = 0; i < max && data[o + i]; i++) s += String.fromCharCode(data[o + i]); return s; };
  let offset = SECTOR;
  while (offset + 3 < data.length) {
    if (int(offset) === 2) {
      const name = str(offset + 4, 127);
      const size = int(offset + 0x8c);
      const chunks = [];
      const pointers = offset + 0x94;
      let k = 0, sector;
      while ((sector = int(pointers + 4 * k++)) !== 0) {
        offset = sector * SECTOR;
        chunks.push(data.subarray(offset, offset + SECTOR));
      }
      const buf = new Uint8Array(chunks.length * SECTOR);
      chunks.forEach((c, i) => buf.set(c, i * SECTOR));
      files[name] = buf.subarray(0, size);
    }
    offset += SECTOR;
  }
  return files;
}

export function gpxToGpif(bytes) {
  let fs = String.fromCharCode(...bytes.subarray(0, 4)) === 'BCFZ' ? bcfzDecompress(bytes) : bytes;
  if (String.fromCharCode(...fs.subarray(0, 4)) !== 'BCFS') throw new Error('Unrecognised .gpx container');
  const files = bcfsFiles(fs.subarray(4));
  const gpif = files['score.gpif'];
  if (!gpif) throw new Error('No score.gpif inside the .gpx file');
  return decodeText(gpif);
}

export async function gp7ToGpif(bytes) {
  const res = await readZipFile(bytes, (e) => /(^|\/)score\.gpif$/i.test(e.name));
  if (!res.data) throw new Error('No Content/score.gpif inside the .gp file');
  return decodeText(res.data);
}

// =========================================================================
// GPIF (Guitar Pro 6/7/8 score XML)
// =========================================================================
const NOTE_VALUES = { Whole: 1, Half: 2, Quarter: 4, Eighth: 8, '16th': 16, '32nd': 32, '64th': 64, '128th': 128 };
const ids = (s) => (s || '').trim().split(/\s+/).filter((x) => x !== '').map(Number);
// GP6 drum kit elements (approximate GM mapping, index = <Element> value)
const GP6_ELEMENTS = [36, 36, 37, 38, 40, 41, 43, 45, 47, 48, 50, 42, 44, 46, 49, 57, 52, 51, 53, 55, 39];

export function parseGPIF(xmlText, format = 'Guitar Pro 7') {
  const x = parseXML(xmlText);
  if (x.name !== 'GPIF') throw new Error('Not a Guitar Pro score (GPIF)');
  const warn = new Warnings();
  const byId = (section, tag) => {
    const map = new Map();
    for (const n of x.child(section)?.all(tag) || []) map.set(+n.attr('id'), n);
    return map;
  };
  const tracksX = byId('Tracks', 'Track');
  const bars = byId('Bars', 'Bar'), voices = byId('Voices', 'Voice'), beats = byId('Beats', 'Beat');
  const notes = byId('Notes', 'Note'), rhythms = byId('Rhythms', 'Rhythm');
  const score = x.child('Score');
  const meta = { title: score?.t('Title'), artist: score?.t('Artist'), album: score?.t('Album'), tempo: 120, time: [4, 4] };

  // tempo automations
  const tempoAt = {};
  for (const a of x.find('MasterTrack/Automations')?.all('Automation') || []) {
    if (a.t('Type') !== 'Tempo') continue;
    const bar = +a.t('Bar'), val = parseFloat(a.t('Value'));
    if (isFinite(val) && val > 0 && tempoAt[bar] == null) tempoAt[bar] = val;
  }
  if (tempoAt[0]) meta.tempo = tempoAt[0];

  const order = ids(x.find('MasterTrack/Tracks')?.text) ;
  const trackIds = order.length ? order : [...tracksX.keys()];
  const prop = (node, name) => (node?.child('Properties')?.all('Property') || []).find((p) => p.attr('name') === name) || null;

  const tracks = trackIds.map((id) => {
    const t = tracksX.get(id);
    const name = t?.t('Name') || `Track ${id + 1}`;
    const staffProps = t?.find('Staves/Staff') || t;
    const tunProp = prop(staffProps, 'Tuning') || prop(t, 'Tuning');
    const tuning = tunProp ? ids(tunProp.t('Pitches')) : [];
    const capoProp = prop(staffProps, 'CapoFret') || prop(t, 'CapoFret');
    const type = t?.t('InstrumentSet/Type') || t?.child('Instrument')?.attr('ref') || '';
    const drums = /drum|perc/i.test(type) || t?.t('MidiConnection/PrimaryChannel') === '9' || (!tuning.length && /drum/i.test(name));
    let inst = instrumentFromProgram(-1, { strings: tuning.length, name: name + ' ' + type, drums, lowest: tuning.length ? Math.min(...tuning) : 40 });
    if (/bass/i.test(type)) inst = 'bass';
    else if (/acoustic|classical|nylon|steel|s-gtr|n-gtr/i.test(type)) inst = 'acoustic';
    else if (/electric|e-gtr/i.test(type) && inst !== 'distortion') inst = 'electric';
    else if (!drums && !tuning.length && /piano|keys|synth|organ/i.test(name + type)) inst = 'keys';
    // GP7 drum articulations -> midi
    const artic = [];
    for (const el of t?.find('InstrumentSet/Elements')?.all('Element') || []) {
      for (const ar of el.child('Articulations')?.all('Articulation') || []) artic.push(+ar.t('OutputMidiNumber') || 38);
    }
    return { name, tuning: drums ? [] : tuning, capo: capoProp ? +capoProp.t('Fret') || 0 : 0, drums, instrument: drums ? 'drums' : inst, bars: [], artic };
  });

  const masterBars = [];
  const mbs = x.child('MasterBars')?.all('MasterBar') || [];
  let curTempo = meta.tempo;
  mbs.forEach((mb, i) => {
    const time = (mb.t('Time') || '4/4').split('/').map(Number);
    const rep = mb.child('Repeat');
    const sec = mb.child('Section');
    if (tempoAt[i]) curTempo = tempoAt[i];
    const m = {
      time, tempo: curTempo,
      repeatStart: rep?.attr('start') === 'true', repeatEnd: rep?.attr('end') === 'true',
      repeatTimes: rep ? Math.max(2, +rep.attr('count', 2) || 2) : undefined,
      section: sec ? (sec.t('Text') || sec.t('Letter')) || undefined : undefined,
    };
    const alt = ids(mb.t('AlternateEndings'));
    if (alt.length) m.ending = alt;
    masterBars.push(m);
    const barIds = ids(mb.t('Bars'));
    tracks.forEach((track, ti) => {
      const bar = bars.get(barIds[ti]);
      const voiceIds = ids(bar?.t('Voices')).filter((v) => v >= 0);
      // pick the voice with the most notes
      let best = [], bestScore = -1;
      for (const vid of voiceIds) {
        const list = readGpifVoice(voices.get(vid), { beats, notes, rhythms, track, prop, warn });
        const sc = list.reduce((a, b) => a + b.notes.length, 0);
        if (sc > bestScore) { best = list; bestScore = sc; }
      }
      track.bars.push(best);
    });
  });
  meta.time = masterBars[0]?.time || [4, 4];
  tracks.forEach((t) => delete t.artic);
  return { format, meta, masterBars, tracks, warnings: warn };
}

function readGpifVoice(voice, { beats, notes, rhythms, track, prop, warn }) {
  if (!voice) return [];
  const out = [];
  for (const bid of ids(voice.t('Beats'))) {
    const b = beats.get(bid);
    if (!b) continue;
    if (b.child('GraceNotes')) continue; // grace notes take no time
    const rh = rhythms.get(+b.child('Rhythm')?.attr('ref'));
    const value = NOTE_VALUES[rh?.t('NoteValue')] || 4;
    const dots = +rh?.child('AugmentationDot')?.attr('count', 0) || 0;
    const tup = rh?.child('PrimaryTuplet');
    const dur = durFromValue(value, dots, tup ? +tup.attr('num') : 0, tup ? +tup.attr('den') : 0, warn);
    const beat = { dur, notes: [] };
    for (const nid of ids(b.t('Notes'))) {
      const n = notes.get(nid);
      if (!n) continue;
      const fretP = prop(n, 'Fret'), strP = prop(n, 'String');
      const note = {};
      if (track.drums) {
        const art = n.child('InstrumentArticulation');
        const midiP = prop(n, 'Midi');
        const elP = prop(n, 'Element');
        if (art && track.artic.length) note.midi = track.artic[+art.text] ?? 38;
        else if (midiP) note.midi = +midiP.t('Number');
        else if (elP) note.midi = GP6_ELEMENTS[+elP.t('Element')] ?? 38;
        else continue;
      } else if (fretP && strP && track.tuning.length) {
        note.fret = +fretP.t('Fret');
        note.string = track.tuning.length - +strP.t('String'); // GPIF string 0 = lowest
      } else {
        const midiP = prop(n, 'Midi');
        const pitch = prop(n, 'ConcertPitch')?.child('Pitch') || prop(n, 'TransposedPitch')?.child('Pitch');
        if (midiP) note.midi = +midiP.t('Number');
        else if (pitch) {
          const step = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[pitch.t('Step')] ?? 0;
          const acc = { '#': 1, b: -1, '##': 2, bb: -2, x: 2 }[pitch.t('Accidental')] || 0;
          note.midi = (+pitch.t('Octave') + 1) * 12 + step + acc;
        } else continue;
      }
      const tie = n.child('Tie');
      if (tie?.attr('destination') === 'true') note.tie = true;
      if (prop(n, 'HopoOrigin')) note.legato = true;
      const slide = prop(n, 'Slide');
      if (slide && (+slide.t('Flags') & 3)) note.slide = true;
      if (prop(n, 'PalmMuted')) note.palmMute = true;
      if (prop(n, 'Muted')) note.dead = true;
      if (prop(n, 'Bended')) {
        const v = Math.max(parseFloat(prop(n, 'BendDestinationValue')?.t('Float')) || 0, parseFloat(prop(n, 'BendMiddleValue')?.t('Float')) || 0);
        if (v > 0) note.bend = Math.max(1, Math.round(v / 50));
      }
      const ht = prop(n, 'HarmonicType');
      if (ht && /natural/i.test(ht.t('HType'))) note.harmonic = true;
      if (n.child('Vibrato')) note.vibrato = true;
      if (n.child('LetRing')) note.letRing = true;
      if (n.child('AntiAccent')) note.ghost = true;
      if (n.child('Accent')) note.accent = true;
      beat.notes.push(note);
    }
    if (!beat.notes.length) beat.rest = true;
    out.push(beat);
  }
  return out;
}
