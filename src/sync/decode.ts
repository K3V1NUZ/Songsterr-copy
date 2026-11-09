// MP3 -> mono Float32Array at 22050 Hz (docs/SYNC_ENGINE.md §5.1). Main thread only:
// decodeAudioData doesn't exist inside Web Workers.
import { SAMPLE_RATE } from './onset';

export interface DecodedAudio {
  /** Mono PCM at SAMPLE_RATE. */
  samples: Float32Array;
  durationMs: number;
}

const cache = new WeakMap<Blob, Promise<DecodedAudio>>();

/** Decodes a recording to mono at the analysis rate (cached per Blob). */
export function decodeForAnalysis(blob: Blob): Promise<DecodedAudio> {
  let p = cache.get(blob);
  if (!p) {
    p = (async () => {
      const bytes = await blob.arrayBuffer();
      // an OfflineAudioContext needs no user gesture (unlike an AudioContext on iOS Safari)
      const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes);
      const length = Math.ceil(decoded.duration * SAMPLE_RATE);
      // 1 output channel: the browser averages the channels; rendering resamples to 22050 Hz
      const ctx = new OfflineAudioContext(1, length, SAMPLE_RATE);
      const src = ctx.createBufferSource();
      src.buffer = decoded;
      src.connect(ctx.destination);
      src.start();
      const rendered = await ctx.startRendering();
      // only the 22 kHz copy is kept: the full-quality buffer can be freed now
      return { samples: rendered.getChannelData(0).slice(), durationMs: decoded.duration * 1000 };
    })();
    p.catch(() => cache.delete(blob));
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

/** Waveform peaks for the manual sync lane (5 ms buckets by default), normalised. */
export function waveformPeaks(audio: DecodedAudio, bucketMs = 5): Peaks {
  const pcm = audio.samples;
  const per = Math.max(1, Math.round((SAMPLE_RATE * bucketMs) / 1000));
  const n = Math.ceil(pcm.length / per);
  const data = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * per; j < Math.min(pcm.length, (i + 1) * per); j++) m = Math.max(m, Math.abs(pcm[j]!));
    data[i] = m;
    max = Math.max(max, m);
  }
  if (max > 0) for (let i = 0; i < n; i++) data[i]! /= max;
  return { data, bucketMs: (per / SAMPLE_RATE) * 1000 };
}
