// Writes a synthetic "recording" of a score with a known time warp, plus the true bar times.
// Only runs when RENDER_OUT is set:  RENDER_OUT=/path/out npx vitest run tests/tools
import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { importer, Settings } from '@coderline/alphatab';
import { scoreTimingFromAlphaTab } from '@/sync/fromAlphaTab';
import { scoreNoteEvents } from '@/sync/scoreEvents';
import { beatToScoreMs, buildTimeline } from '@/sync/timeline';

it.skipIf(!process.env.RENDER_OUT)('render fixture', () => {
  const out = process.env.RENDER_OUT!;
  const score = importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync('public/samples/greensleeves.musicxml')), new Settings());
  const tl = buildTimeline(scoreTimingFromAlphaTab(score));
  const events = scoreNoteEvents(score, tl);
  const sr = 22050, P = 20000, amp = 0.04;
  const warp = (ms: number) => 1500 + ms - ((amp * P) / (2 * Math.PI)) * (Math.cos((2 * Math.PI * ms) / P) - 1);
  const total = Math.ceil(((warp(tl.totalMs) + 2500) / 1000) * sr);
  const pcm = new Float32Array(total);
  for (const e of events) {
    if (e.midi === undefined) continue;
    const s0 = warp(beatToScoreMs(tl, e.beat)) / 1000, s1 = warp(beatToScoreMs(tl, e.beat + e.durBeats)) / 1000;
    const i0 = Math.round(s0 * sr), len = Math.min(Math.round((s1 - s0 + 0.2) * sr), sr * 2);
    const f = 440 * 2 ** ((e.midi - 69) / 12);
    for (let i = 0; i < len && i0 + i < total; i++) {
      const t = i / sr;
      // short attack, natural decay, and a 20 ms fade at the end (a hard cut would click like an attack)
      const release = Math.min(1, (len - i) / (0.02 * sr));
      pcm[i0 + i]! += 0.08 * Math.min(1, i / 40) * release * Math.exp(-t * 2.5) * (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t) + 0.2 * Math.sin(6 * Math.PI * f * t));
    }
  }
  const buf = Buffer.alloc(44 + total * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + total * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(total * 2, 40);
  for (let i = 0; i < total; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i]!)) * 32000), 44 + i * 2);
  writeFileSync(`${out}.wav`, buf);
  writeFileSync(`${out}.truth.json`, JSON.stringify(tl.played.map((p) => Math.round(warp(p.startMs)))));
});
