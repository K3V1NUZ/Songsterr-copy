// Auto-sync against synthetic recordings with a known time warp.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importer, Settings } from '@coderline/alphatab';
import { ANALYSIS_RATE, autoSync } from '@/sync/analysis';
import { scoreTimingFromAlphaTab } from '@/sync/fromAlphaTab';
import { scoreNoteEvents, type NoteEvent } from '@/sync/scoreEvents';
import { beatToScoreMs, buildTimeline, type Timeline } from '@/sync/timeline';
import { createSyncMap } from '@/sync/syncMap';

const score = importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync('public/samples/greensleeves.musicxml')), new Settings());
const tl = buildTimeline(scoreTimingFromAlphaTab(score));
const events = scoreNoteEvents(score, tl);

/** Renders note events into PCM; `warp` maps score ms -> recording ms. */
function render(tl: Timeline, evs: NoteEvent[], warp: (scoreMs: number) => number, opts: { pitched?: boolean; noise?: number; seed?: number } = {}): Float32Array {
  const total = Math.ceil(((warp(tl.totalMs) + 2000) / 1000) * ANALYSIS_RATE);
  const out = new Float32Array(total);
  let seed = opts.seed ?? 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (const e of evs) {
    const startS = warp(beatToScoreMs(tl, e.beat)) / 1000;
    const endS = warp(beatToScoreMs(tl, e.beat + e.durBeats)) / 1000;
    const i0 = Math.round(startS * ANALYSIS_RATE);
    const len = Math.min(Math.round((endS - startS + 0.15) * ANALYSIS_RATE), ANALYSIS_RATE * 1.5);
    if (opts.pitched === false || e.midi === undefined) {
      for (let i = 0; i < ANALYSIS_RATE * 0.04 && i0 + i < total; i++) out[i0 + i]! += rnd() * 0.6 * Math.exp(-i / (ANALYSIS_RATE * 0.01));
      continue;
    }
    const f = 440 * 2 ** ((e.midi - 69) / 12);
    for (let i = 0; i < len && i0 + i < total; i++) {
      const t = i / ANALYSIS_RATE;
      const env = Math.min(1, i / 30) * Math.exp(-t * 3);
      out[i0 + i]! += 0.12 * env * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t));
    }
  }
  const noise = opts.noise ?? 0.01;
  for (let i = 0; i < total; i++) out[i]! += rnd() * noise;
  return out;
}

function errors(result: ReturnType<typeof autoSync>, warp: (ms: number) => number) {
  if (process.env.DEBUG_SYNC) for (const [k, v] of Object.entries(result.stages ?? {})) {
    const e = v.map((ms, i) => ms - warp(tl.played[i]!.startMs));
    console.log(k.padEnd(9), 'mean|err|', (e.reduce((a, b) => a + Math.abs(b), 0) / e.length).toFixed(0), 'errs', e.slice(0, 14).map((x) => x.toFixed(0)).join(' '));
  }
  const map = createSyncMap(tl, result.syncPoints);
  const errs = tl.played.map((p) => Math.abs(map.beatToMs(p.startBeat) - warp(p.startMs)));
  return { mean: errs.reduce((a, b) => a + b, 0) / errs.length, max: Math.max(...errs) };
}

describe('auto-sync', () => {
  it('finds the intro offset and a slower tempo (BPM given)', () => {
    const ratio = 100 / 96; // recorded at 96 bpm, written at 100
    const warp = (ms: number) => 2300 + ms * ratio;
    const res = autoSync({ pcm: render(tl, events, warp), timeline: tl, events, bpm: 96 });
    const e = errors(res, warp);
    expect(res.offsetMs).toBeGreaterThan(2200);
    expect(res.offsetMs).toBeLessThan(2400);
    expect(e.mean).toBeLessThan(25);
    expect(e.max).toBeLessThan(80);
    expect(res.confidence).toBeGreaterThan(0.6);
  });

  it('follows a drifting live tempo (±5 %) with DTW', () => {
    const period = 25000, amp = 0.05;
    const warp = (ms: number) => 1100 + ms - ((amp * period) / (2 * Math.PI)) * (Math.cos((2 * Math.PI * ms) / period) - 1);
    const res = autoSync({ pcm: render(tl, events, warp, { noise: 0.02 }), timeline: tl, events, bpm: 100 });
    const e = errors(res, warp);
    expect(res.method).toBe('onsets+dtw');
    expect(e.mean).toBeLessThan(35);
    expect(e.max).toBeLessThan(120);
  });

  it('works on onsets alone (drum-like recording)', () => {
    const ratio = 0.97;
    const warp = (ms: number) => 800 + ms * ratio;
    const res = autoSync({ pcm: render(tl, events, warp, { pitched: false }), timeline: tl, events: events.map(({ beat, durBeats }) => ({ beat, durBeats })), bpm: 100 / 0.97 });
    const e = errors(res, warp);
    expect(res.method).toBe('onsets');
    expect(e.mean).toBeLessThan(25);
  });

  it('reports low confidence for audio that does not match the score', () => {
    // pure noise
    const pcm = new Float32Array(ANALYSIS_RATE * 60);
    let s = 7;
    for (let i = 0; i < pcm.length; i++) { s = (s * 16807) % 2147483647; pcm[i] = (s / 2147483647 - 0.5) * 0.3; }
    const res = autoSync({ pcm, timeline: tl, events, bpm: 100 });
    expect(res.confidence).toBeLessThan(0.5);
  });
});
