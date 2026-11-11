/// <reference lib="webworker" />
// Runs onset -> tempo -> beatTracker -> align off the UI thread (docs/SYNC_ENGINE.md §9).
import { analyze, analyzeFrom, type Stage } from './pipeline';
import type { Anchor, ScoreBeat, ScoreOnset, SyncWarningCode } from './types';

/** main -> worker */
export interface AnalyzeRequest {
  type: 'analyze';
  samples: Float32Array;
  sampleRate: number;
  scoreBeats: ScoreBeat[];
  onsets: ScoreOnset[];
  tempoScale: number;
  /** Manual anchors that re-analysis must keep (docs §8). */
  lockedAnchors: Anchor[];
  /** "Sync from here": keep the anchors before and at `beat`, sync the rest again. */
  from?: { beat: number; anchors: Anchor[] };
}

/** worker -> main */
export type WorkerMessage =
  | { type: 'progress'; stage: Stage; pct: number }
  | { type: 'warning'; code: SyncWarningCode; detail: string }
  | { type: 'result'; anchors: Anchor[]; localBpm: number[]; confidence: number }
  | { type: 'error'; message: string };

self.onmessage = (e: MessageEvent<AnalyzeRequest>) => {
  const post = (m: WorkerMessage) => self.postMessage(m);
  const req = e.data;
  if (req.type !== 'analyze') return;
  try {
    const base = { samples: req.samples, sampleRate: req.sampleRate, scoreBeats: req.scoreBeats, onsets: req.onsets, tempoScale: req.tempoScale };
    const progress = (stage: Stage, pct: number) => post({ type: 'progress', stage, pct });
    const res = req.from
      ? analyzeFrom({ ...base, anchors: req.from.anchors, fromBeat: req.from.beat }, progress)
      : analyze({ ...base, lockedAnchors: req.lockedAnchors }, progress);
    for (const w of res.warnings) post({ type: 'warning', code: w.code, detail: w.detail });
    post({ type: 'result', anchors: res.anchors, localBpm: res.localBpm, confidence: res.confidence });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
