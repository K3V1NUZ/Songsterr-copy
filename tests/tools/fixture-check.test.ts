// Runs auto-sync on a rendered fixture WAV in Node (no browser decoding). Only with FIXTURE=/path/name
import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { importer, Settings } from '@coderline/alphatab';
import { autoSync, onsetEnvelope, ONSET_FPS } from '@/sync/analysis';
import { beatToScoreMs } from '@/sync/timeline';
import { scoreTimingFromAlphaTab } from '@/sync/fromAlphaTab';
import { scoreNoteEvents } from '@/sync/scoreEvents';
import { buildTimeline } from '@/sync/timeline';

it.skipIf(!process.env.FIXTURE)('fixture check', () => {
  const base = process.env.FIXTURE!;
  const wav = readFileSync(`${base}.wav`);
  const sr = wav.readUInt32LE(24);
  const n = (wav.length - 44) / 2;
  const step = sr / 11025;
  const pcm = new Float32Array(Math.floor(n / step));
  for (let i = 0; i < pcm.length; i++) { const j = Math.floor(i * step); let s = 0; for (let k = 0; k < step; k++) s += wav.readInt16LE(44 + (j + k) * 2) / 32768; pcm[i] = s / step; }
  const truth: number[] = JSON.parse(readFileSync(`${base}.truth.json`, 'utf8'));
  const score = importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync('public/samples/greensleeves.musicxml')), new Settings());
  const tl = buildTimeline(scoreTimingFromAlphaTab(score));
  const res = autoSync({ pcm, timeline: tl, events: scoreNoteEvents(score, tl), bpm: 100 });
  for (const [k, v] of Object.entries(res.stages ?? {})) console.log(k.padEnd(8), v.slice(0, 12).map((ms, i) => (ms - truth[i]!).toFixed(0)).join(' '));
  const env = onsetEnvelope(pcm);
  const P = 20000, amp = 0.04, warp = (ms: number) => 1500 + ms - ((amp * P) / (2 * Math.PI)) * (Math.cos((2 * Math.PI * ms) / P) - 1);
  for (const k of [2, 3, 4]) {
    const t = truth[k]!;
    const peaks: string[] = [];
    for (let f = Math.round(((t - 400) / 1000) * ONSET_FPS); f < Math.round(((t + 700) / 1000) * ONSET_FPS); f++) {
      if (env[f]! > 0.15 && env[f]! >= env[f - 1]! && env[f]! > env[f + 1]!) peaks.push(`${Math.round((f / ONSET_FPS) * 1000 - t)}(${env[f]!.toFixed(2)})`);
    }
    const p = tl.played[k]!;
    const exp = scoreNoteEvents(score, tl).filter((e) => e.beat >= p.startBeat && e.beat < p.startBeat + 1.2).map((e) => `${Math.round(warp(beatToScoreMs(tl, e.beat)) - t)}:${e.midi}`);
    console.log('bar', k + 1, 'peaks rel. to true downbeat:', peaks.join(' '), '| expected onsets:', [...new Set(exp)].join(' '));
  }
  console.log('confidence', res.confidence, 'offset', res.offsetMs.toFixed(0), 'ratio', res.ratio.toFixed(4));
});
