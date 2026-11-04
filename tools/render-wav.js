#!/usr/bin/env node
// Render a score (MusicXML / Guitar Pro) to a WAV using the built-in synth.
//   node tools/render-wav.js song.musicxml out.wav [--lead 2.0] [--tempo-scale 0.96] [--rate 22050]
// --lead         seconds of silence before bar 1 (like a real recording's intro gap)
// --tempo-scale  play slower/faster than the tab tempo (to practise syncing)
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { loadScore } from '../public/js/importers/index.js';
import { buildTimeline, buildNoteEvents } from '../public/js/timeline.js';
import { pluck, drum, deadNote } from '../public/js/ks.js';

const [inp, out] = process.argv.slice(2);
const opt = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? +process.argv[i + 1] : d; };
if (!inp || !out) { console.log('usage: node tools/render-wav.js in.musicxml out.wav [--lead s] [--tempo-scale x] [--rate hz]'); process.exit(2); }
const lead = opt('--lead', 0), scale = opt('--tempo-scale', 1), sr = opt('--rate', 22050);
const { song, errors } = await loadScore(basename(inp), readFileSync(inp));
if (!song) { console.error(errors); process.exit(1); }
const tl = buildTimeline(song);
const events = buildNoteEvents(tl, song);
const total = Math.ceil((lead + tl.duration / scale + 3) * sr);
const mix = new Float32Array(total);
const cache = new Map();
const get = (k, g) => { if (!cache.has(k)) cache.set(k, g()); return cache.get(k); };
for (const ev of events) {
  const tr = song.tracks[ev.track], n = ev.note;
  const start = Math.floor((lead + ev.t / scale) * sr);
  const len = Math.floor((ev.dur / scale + 0.15) * sr);
  let buf, gain = (n.ghost ? 0.35 : n.accent ? 1 : 0.75) * tr.volume * (ev.legato ? 0.6 : 1);
  if (tr.instrument === 'drums') buf = get('d' + n.drum, () => drum(n.drum, sr));
  else if (n.dead) buf = get('dead', () => deadNote(sr));
  else { buf = get(`${tr.instrument}${ev.midi}${!!n.palmMute}`, () => pluck(ev.midi, sr, { instrument: tr.instrument, mute: !!n.palmMute })); gain *= tr.instrument === 'bass' ? 1.1 : 0.55; }
  const L = Math.min(buf.length, len, total - start);
  const rel = Math.floor(0.12 * sr);
  for (let i = 0; i < L; i++) {
    const env = i > L - rel && L === len ? (L - i) / rel : 1;
    mix[start + i] += buf[i] * gain * env;
  }
}
let peak = 0; for (const v of mix) peak = Math.max(peak, Math.abs(v));
const norm = peak > 0 ? 0.89 / peak : 1;
const data = Buffer.alloc(44 + total * 2);
data.write('RIFF', 0); data.writeUInt32LE(36 + total * 2, 4); data.write('WAVEfmt ', 8);
data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(sr, 24);
data.writeUInt32LE(sr * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(total * 2, 40);
for (let i = 0; i < total; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(mix[i] * norm * 32767))), 44 + i * 2);
writeFileSync(out, data);
const lastBar = tl.played.length;
console.log(`Wrote ${out}: ${(total / sr).toFixed(1)} s, bar 1 at ${lead.toFixed(3)} s, bar ${lastBar} at ${(lead + tl.played[lastBar - 1].start / scale).toFixed(3)} s`);
