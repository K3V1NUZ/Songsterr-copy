// Sync engine tests with synthetic recordings (docs/SYNC_ENGINE.md §11).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { importer, Settings } from '@coderline/alphatab';
import { localBpm, trackBeats } from '@/sync/beatTracker';
import { fft } from '@/sync/fft';
import { scoreTimingFromAlphaTab } from '@/sync/fromAlphaTab';
import { FPS, onsetCurve, SAMPLE_RATE } from '@/sync/onset';
import { analyze, type AnalyzeResult } from '@/sync/pipeline';
import { anchorsToSyncPoints, quarterToScoreBeat, scoreBeats, scoreOnsets } from '@/sync/scoreBeats';
import { scoreNoteEvents, type NoteEvent } from '@/sync/scoreEvents';
import { createSyncMap } from '@/sync/syncMap';
import { refineTempo } from '@/sync/tempo';
import { beatToScoreMs, buildTimeline, type BarTiming, type Timeline } from '@/sync/timeline';

const SR = SAMPLE_RATE;

function rng(seed: number) {
  return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
}

/** A short noise burst at each time (seconds). */
function clickTrack(times: number[], seconds: number, gain: (i: number) => number = () => 1, seed = 1): Float32Array {
  const pcm = new Float32Array(Math.ceil(seconds * SR));
  const rnd = rng(seed);
  times.forEach((t, k) => {
    const i0 = Math.round(t * SR);
    for (let i = 0; i < SR * 0.03 && i0 + i < pcm.length; i++) pcm[i0 + i]! += gain(k) * rnd() * Math.exp(-i / (SR * 0.005));
  });
  for (let i = 0; i < pcm.length; i++) pcm[i]! += rnd() * 0.002;
  return pcm;
}

/** A plain score: `bars` bars of `sig`, at `bpm` (quarters per minute). */
function plainTimeline(bars: number, bpm: number, sig: [number, number] = [4, 4]): Timeline {
  const bar: BarTiming = { quarters: (sig[0] * 4) / sig[1], tempoChanges: [], isRepeatStart: false, repeatCount: 0, alternateEndings: 0, timeSignature: sig };
  return buildTimeline({ initialBpm: bpm, bars: Array.from({ length: bars }, (_, i) => ({ ...bar, tempoChanges: i === 0 ? [{ position: 0, bpm }] : [] })) });
}

/** Runs the pipeline on a click-track score with a note on every beat. */
function runClicks(tl: Timeline, pcm: Float32Array, tempoScale = 1): AnalyzeResult {
  const beats = scoreBeats(tl);
  return analyze({ samples: pcm, sampleRate: SR, scoreBeats: beats, onsets: beats.map((b) => ({ scoreBeat: b.index, weight: 1 })), tempoScale });
}

function maxError(res: AnalyzeResult, truth: number[]): number {
  return Math.max(...truth.map((t, j) => Math.abs(res.anchors[j]!.time - t)));
}

describe('fft', () => {
  it('finds a pure tone in the right bin', () => {
    const n = 64, re = new Float32Array(n), im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 5 * i) / n);
    fft(re, im);
    const mag = Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k]!, im[k]!));
    expect(mag.indexOf(Math.max(...mag))).toBe(5);
    expect(mag[5]).toBeCloseTo(n / 2, 3);
  });
});

describe('score beats', () => {
  it('counts dotted quarters in compound meters and only the real beats of a pickup bar', () => {
    const tl = buildTimeline({
      initialBpm: 90,
      bars: [
        { quarters: 1, tempoChanges: [], isRepeatStart: false, repeatCount: 0, alternateEndings: 0, timeSignature: [4, 4] }, // pickup: one beat
        { quarters: 4, tempoChanges: [], isRepeatStart: false, repeatCount: 0, alternateEndings: 0, timeSignature: [4, 4] },
        { quarters: 3, tempoChanges: [], isRepeatStart: false, repeatCount: 0, alternateEndings: 0, timeSignature: [6, 8] },
      ],
    });
    const beats = scoreBeats(tl);
    expect(beats.map((b) => `${b.bar}.${b.beatInBar}`)).toEqual(['1.1', '2.1', '2.2', '2.3', '2.4', '3.1', '3.2']);
    expect(beats[5]!.expectedBpm).toBeCloseTo(60); // 90 quarters = 60 dotted quarters per minute
    expect(quarterToScoreBeat(beats, 5 + 0.75)).toBeCloseTo(5.5);
  });

  it('unrolls repeats: a repeated bar gives its beats twice', () => {
    const bar = (o: Partial<BarTiming>): BarTiming => ({ quarters: 4, tempoChanges: [], isRepeatStart: false, repeatCount: 0, alternateEndings: 0, ...o });
    const tl = buildTimeline({ initialBpm: 120, bars: [bar({ isRepeatStart: true }), bar({ repeatCount: 2 }), bar({})] });
    expect(scoreBeats(tl)).toHaveLength(5 * 4);
  });
});

describe('onsets and tempo', () => {
  it('puts onset peaks on the clicks', () => {
    const times = Array.from({ length: 20 }, (_, k) => 1 + k * 0.5);
    const curve = onsetCurve(clickTrack(times, 12));
    for (const t of times) {
      const f = Math.round(t * FPS);
      let best = f;
      for (let i = f - 4; i <= f + 4; i++) if (curve[i]! > curve[best]!) best = i;
      expect(Math.abs(best / FPS - t)).toBeLessThan(0.015);
    }
  });

  it('refines a slightly wrong BPM hint', () => {
    const times = Array.from({ length: 80 }, (_, k) => 1 + (k * 60) / 118.5);
    const est = refineTempo(onsetCurve(clickTrack(times, 45)), 120);
    expect(est.bpm).toBeGreaterThan(117.8);
    expect(est.bpm).toBeLessThan(119.2);
    expect(est.warning).toBeUndefined();
  });

  it('warns when the audio is clearly at half the hinted tempo', () => {
    const times = Array.from({ length: 40 }, (_, k) => 1 + k * 1.0); // 60 BPM clicks
    const est = refineTempo(onsetCurve(clickTrack(times, 45)), 120);
    expect(est.warning?.code).toBe('TEMPO_HALF');
  });
});

describe('beat tracker', () => {
  it('plays through a quiet spot (the worked example in the doc)', () => {
    const O = Float32Array.from([5, 0, 0, 1, 4, 0, 0, 0, 0, 1, 0, 0, 6]);
    expect(trackBeats(O, 4).map((b) => b.frame)).toEqual([0, 4, 8, 12]);
  });

  it('reports the local BPM', () => {
    expect(localBpm([0, 0.5, 1, 1.5, 2])[0]).toBeCloseTo(120);
  });
});

describe('click tracks end to end', () => {
  it('steady 120 BPM: every beat within ±20 ms', () => {
    const tl = plainTimeline(16, 120);
    const truth = Array.from({ length: 64 }, (_, k) => 1 + k * 0.5);
    const res = runClicks(tl, clickTrack(truth, 35));
    expect(res.anchors).toHaveLength(64);
    expect(maxError(res, truth)).toBeLessThan(0.02);
    expect(res.confidence).toBeGreaterThan(0.6);
  });

  it('follows a ramp from 100 to 130 BPM', () => {
    const tl = plainTimeline(16, 115);
    const truth: number[] = [1];
    for (let k = 1; k < 64; k++) truth.push(truth[k - 1]! + 60 / (100 + (30 * k) / 63));
    const res = runClicks(tl, clickTrack(truth, 40));
    expect(maxError(res, truth)).toBeLessThan(0.02);
  });

  it('plays through every 7th beat missing', () => {
    const tl = plainTimeline(16, 120);
    const truth = Array.from({ length: 64 }, (_, k) => 1 + k * 0.5);
    const res = runClicks(tl, clickTrack(truth.filter((_, k) => k % 7 !== 6), 35));
    expect(maxError(res, truth)).toBeLessThan(0.02);
  });

  it('skips 2 s of silence and a 4-click count-in to find the first downbeat', () => {
    const tl = plainTimeline(16, 120);
    const countIn = [2, 2.5, 3, 3.5];
    const truth = Array.from({ length: 64 }, (_, k) => 4 + k * 0.5);
    // count-in: quiet sticks; the song: accented downbeats
    const all = [...countIn, ...truth];
    const res = runClicks(tl, clickTrack(all, 40, (i) => (i < 4 ? 0.3 : (i - 4) % 4 === 0 ? 1 : 0.6)));
    expect(Math.abs(res.anchors[0]!.time - 4)).toBeLessThan(0.02);
    expect(maxError(res, truth)).toBeLessThan(0.02);
  });

  it('gives low confidence for audio that does not match the score', () => {
    const tl = plainTimeline(16, 120);
    const pcm = new Float32Array(SR * 40);
    const rnd = rng(7);
    for (let i = 0; i < pcm.length; i++) pcm[i] = rnd() * 0.3;
    expect(runClicks(tl, pcm).confidence).toBeLessThan(0.5);
  });
});

// ---- a real score: Greensleeves rendered with a known time warp -----------------------------------
const score = importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync('public/samples/greensleeves.musicxml')), new Settings());
const tl = buildTimeline(scoreTimingFromAlphaTab(score));
const events = scoreNoteEvents(score, tl);
const beats = scoreBeats(tl);
const onsets = scoreOnsets(beats, events);

/** Renders note events into PCM; `warp` maps score ms -> recording ms. */
function render(evs: NoteEvent[], warp: (scoreMs: number) => number, opts: { pitched?: boolean; noise?: number; seed?: number } = {}): Float32Array {
  const total = Math.ceil(((warp(tl.totalMs) + 2000) / 1000) * SR);
  const out = new Float32Array(total);
  const rnd = rng(opts.seed ?? 1);
  for (const e of evs) {
    const startS = warp(beatToScoreMs(tl, e.beat)) / 1000;
    const endS = warp(beatToScoreMs(tl, e.beat + e.durBeats)) / 1000;
    const i0 = Math.round(startS * SR);
    const len = Math.min(Math.round((endS - startS + 0.15) * SR), SR * 1.5);
    if (opts.pitched === false || e.midi === undefined) {
      for (let i = 0; i < SR * 0.04 && i0 + i < total; i++) out[i0 + i]! += rnd() * 0.6 * Math.exp(-i / (SR * 0.01));
      continue;
    }
    const f = 440 * 2 ** ((e.midi - 69) / 12);
    for (let i = 0; i < len && i0 + i < total; i++) {
      const t = i / SR;
      const env = Math.min(1, i / 30) * Math.exp(-t * 3);
      out[i0 + i]! += 0.12 * env * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t));
    }
  }
  const noise = opts.noise ?? 0.01;
  for (let i = 0; i < total; i++) out[i]! += rnd() * noise;
  return out;
}

/** Bar-start errors (ms) after converting the anchors to the player's sync points. */
function barErrors(res: AnalyzeResult, warp: (ms: number) => number) {
  const map = createSyncMap(tl, anchorsToSyncPoints(tl, beats, res.anchors));
  const errs = tl.played.map((p) => Math.abs(map.beatToMs(p.startBeat) - warp(p.startMs)));
  return { mean: errs.reduce((a, b) => a + b, 0) / errs.length, max: Math.max(...errs) };
}

describe('Greensleeves end to end', () => {
  const writtenBpm = tl.played[0]!.segments[0]!.bpm;

  it('finds the intro offset and a slower tempo (BPM given)', () => {
    const ratio = writtenBpm / 96; // recorded at 96 bpm
    const warp = (ms: number) => 2300 + ms * ratio;
    const res = analyze({ samples: render(events, warp), sampleRate: SR, scoreBeats: beats, onsets, tempoScale: 96 / writtenBpm });
    const e = barErrors(res, warp);
    expect(e.mean).toBeLessThan(25);
    expect(e.max).toBeLessThan(80);
    expect(res.confidence).toBeGreaterThan(0.6);
  });

  it('follows a drifting live tempo (±5 %)', () => {
    const period = 25000, amp = 0.05;
    const warp = (ms: number) => 1100 + ms - ((amp * period) / (2 * Math.PI)) * (Math.cos((2 * Math.PI * ms) / period) - 1);
    const res = analyze({ samples: render(events, warp, { noise: 0.02 }), sampleRate: SR, scoreBeats: beats, onsets });
    const e = barErrors(res, warp);
    expect(e.mean).toBeLessThan(35);
    expect(e.max).toBeLessThan(120);
  });

  it('works on a drum-like recording (no pitch)', () => {
    const warp = (ms: number) => 800 + ms * 0.97;
    const res = analyze({ samples: render(events, warp, { pitched: false }), sampleRate: SR, scoreBeats: beats, onsets, tempoScale: 1 / 0.97 });
    expect(barErrors(res, warp).mean).toBeLessThan(25);
  });
});
