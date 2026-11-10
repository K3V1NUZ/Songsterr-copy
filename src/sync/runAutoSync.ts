// Main-thread side of auto-sync: decode the recording, build the score's beats and run the analysis
// in sync.worker.ts.
import type { model } from '@coderline/alphatab';
import { decodeForAnalysis } from './decode';
import { SAMPLE_RATE } from './onset';
import type { Stage } from './pipeline';
import { scoreBeats, scoreOnsets } from './scoreBeats';
import { scoreNoteEvents } from './scoreEvents';
import type { AnalyzeRequest, WorkerMessage } from './sync.worker';
import type { Timeline } from './timeline';
import type { Anchor, SyncWarning } from './types';

export interface AutoSyncResult {
  /** One per score beat (manual anchors passed in are kept as they are). */
  anchors: Anchor[];
  /** 0..1 */
  confidence: number;
  warnings: SyncWarning[];
  /** Local tempo at each score beat (beats per minute). */
  localBpm: number[];
}

const STAGES: Record<Stage, [number, number, string]> = {
  onset: [0.1, 0.6, 'Finding note onsets'],
  tempo: [0.6, 0.75, 'Measuring the tempo'],
  beats: [0.75, 0.9, 'Tracking the beats'],
  align: [0.9, 1, 'Lining up the score'],
};

/**
 * @param bpm the recording's BPM entered by the user (quarter notes per minute); 0 = the score's tempo
 * @param lockedAnchors manual anchors: kept exactly, auto-sync only fills in the beats between them
 */
export async function runAutoSync(
  blob: Blob,
  score: model.Score,
  timeline: Timeline,
  bpm: number,
  onProgress: (fraction: number, stage: string) => void,
  lockedAnchors: Anchor[] = [],
): Promise<AutoSyncResult> {
  onProgress(0, 'Decoding the recording');
  const audio = await decodeForAnalysis(blob);
  const beats = scoreBeats(timeline);
  const onsets = scoreOnsets(beats, scoreNoteEvents(score, timeline));
  const writtenBpm = timeline.played[0]?.segments[0]?.bpm ?? 120;
  const tempoScale = bpm > 0 ? bpm / writtenBpm : 1;

  const worker = new Worker(new URL('./sync.worker.ts', import.meta.url), { type: 'module' });
  const warnings: SyncWarning[] = [];
  try {
    const res = await new Promise<Extract<WorkerMessage, { type: 'result' }>>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
        const m = e.data;
        if (m.type === 'progress') {
          const [a, b, text] = STAGES[m.stage];
          onProgress(a + (b - a) * m.pct, text);
        } else if (m.type === 'warning') warnings.push({ code: m.code, detail: m.detail });
        else if (m.type === 'result') resolve(m);
        else reject(new Error(m.message));
      };
      worker.onerror = (e) => reject(new Error(e.message || 'Auto-sync worker failed'));
      // copy the samples: the decoded audio stays cached for the waveform lane
      const samples = audio.samples.slice();
      const req: AnalyzeRequest = { type: 'analyze', samples, sampleRate: SAMPLE_RATE, scoreBeats: beats, onsets, tempoScale, lockedAnchors };
      worker.postMessage(req, [samples.buffer]);
    });
    return {
      anchors: res.anchors,
      confidence: res.confidence,
      warnings,
      localBpm: res.localBpm,
    };
  } finally {
    worker.terminate();
  }
}
