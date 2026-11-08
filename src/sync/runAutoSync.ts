// Main-thread side of auto-sync: decode + resample the recording, then run the
// analysis in a Web Worker. Also builds waveform peaks for the manual sync tool.
import type { model } from '@coderline/alphatab';
import type { AutoSyncResult } from './analysis';
import { ANALYSIS_RATE } from './analysis';
import { scoreNoteEvents } from './scoreEvents';
import type { Timeline } from './timeline';
import type { AutoSyncMessage } from '@/workers/autosync.worker';

export interface DecodedAudio {
  /** Mono PCM at ANALYSIS_RATE. */
  pcm: Float32Array;
  durationMs: number;
}

const cache = new WeakMap<Blob, Promise<DecodedAudio>>();

/** Decodes a recording to mono at the analysis rate (cached per Blob). */
export function decodeForAnalysis(blob: Blob): Promise<DecodedAudio> {
  let p = cache.get(blob);
  if (!p) {
    p = (async () => {
      const bytes = await blob.arrayBuffer();
      const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes);
      const length = Math.ceil(decoded.duration * ANALYSIS_RATE);
      const ctx = new OfflineAudioContext(1, length, ANALYSIS_RATE); // 1 channel: the browser down-mixes
      const src = ctx.createBufferSource();
      src.buffer = decoded;
      src.connect(ctx.destination);
      src.start();
      const rendered = await ctx.startRendering();
      return { pcm: rendered.getChannelData(0).slice(), durationMs: decoded.duration * 1000 };
    })();
    cache.set(blob, p);
  }
  return p;
}

export interface Peaks {
  /** Max |sample| per bucket, 0..1. */
  data: Float32Array;
  /** Milliseconds per bucket. */
  bucketMs: number;
}

/** Waveform peaks at 5 ms resolution, normalised. */
export function waveformPeaks(audio: DecodedAudio, bucketMs = 5): Peaks {
  const per = Math.max(1, Math.round((ANALYSIS_RATE * bucketMs) / 1000));
  const n = Math.ceil(audio.pcm.length / per);
  const data = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * per; j < Math.min(audio.pcm.length, (i + 1) * per); j++) m = Math.max(m, Math.abs(audio.pcm[j]!));
    data[i] = m;
    max = Math.max(max, m);
  }
  if (max > 0) for (let i = 0; i < n; i++) data[i]! /= max;
  return { data, bucketMs: (per / ANALYSIS_RATE) * 1000 };
}

export async function runAutoSync(
  blob: Blob,
  score: model.Score,
  timeline: Timeline,
  bpm: number,
  onProgress: (fraction: number, stage: string) => void,
): Promise<AutoSyncResult> {
  onProgress(0, 'Decoding the recording');
  const audio = await decodeForAnalysis(blob);
  const events = scoreNoteEvents(score, timeline);
  const worker = new Worker(new URL('../workers/autosync.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise<AutoSyncResult>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<AutoSyncMessage>) => {
        const m = e.data;
        if (m.type === 'progress') onProgress(m.fraction, m.stage);
        else if (m.type === 'done') resolve(m.result);
        else reject(new Error(m.message));
      };
      worker.onerror = (e) => reject(new Error(e.message || 'Auto-sync worker failed'));
      // copy the PCM: the decoded audio stays cached for the waveform
      const pcm = audio.pcm.slice();
      worker.postMessage({ pcm, timeline, events, bpm }, [pcm.buffer]);
    });
  } finally {
    worker.terminate();
  }
}
