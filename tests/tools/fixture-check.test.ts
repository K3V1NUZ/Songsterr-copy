// Runs auto-sync on a rendered fixture WAV in Node (no browser decoding). Only with FIXTURE=/path/name
// (see render-fixture.test.ts for making one).
import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { importer, Settings } from '@coderline/alphatab';
import { scoreTimingFromAlphaTab } from '@/sync/fromAlphaTab';
import { SAMPLE_RATE } from '@/sync/onset';
import { analyze } from '@/sync/pipeline';
import { scoreBeats, scoreOnsets } from '@/sync/scoreBeats';
import { scoreNoteEvents } from '@/sync/scoreEvents';
import { buildTimeline } from '@/sync/timeline';

it.skipIf(!process.env.FIXTURE)('fixture check', () => {
  const base = process.env.FIXTURE!;
  const wav = readFileSync(`${base}.wav`);
  const sr = wav.readUInt32LE(24);
  const n = (wav.length - 44) / 2;
  const step = sr / SAMPLE_RATE;
  const samples = new Float32Array(Math.floor(n / step));
  for (let i = 0; i < samples.length; i++) { const j = Math.floor(i * step); let s = 0; for (let k = 0; k < step; k++) s += wav.readInt16LE(44 + (j + k) * 2) / 32768; samples[i] = s / step; }
  const truth: number[] = JSON.parse(readFileSync(`${base}.truth.json`, 'utf8'));
  const score = importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync('public/samples/greensleeves.musicxml')), new Settings());
  const tl = buildTimeline(scoreTimingFromAlphaTab(score));
  const beats = scoreBeats(tl);
  const res = analyze({ samples, sampleRate: SAMPLE_RATE, scoreBeats: beats, onsets: scoreOnsets(beats, scoreNoteEvents(score, tl)) });
  const downbeats = res.anchors.filter((a) => beats[a.scoreBeat]!.isDownbeat);
  console.log('bar start error (ms):', downbeats.slice(0, 16).map((a, i) => (a.time * 1000 - truth[i]!).toFixed(0)).join(' '));
  console.log('confidence', res.confidence, 'warnings', res.warnings.map((w) => w.code).join(', ') || 'none');
});
