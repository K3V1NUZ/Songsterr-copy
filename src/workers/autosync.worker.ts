/// <reference lib="webworker" />
// Runs the auto-sync analysis off the main thread.
import { autoSync, type AutoSyncInput, type AutoSyncResult } from '@/sync/analysis';

export type AutoSyncRequest = AutoSyncInput;
export type AutoSyncMessage =
  | { type: 'progress'; fraction: number; stage: string }
  | { type: 'done'; result: AutoSyncResult }
  | { type: 'error'; message: string };

self.onmessage = (e: MessageEvent<AutoSyncRequest>) => {
  const post = (m: AutoSyncMessage) => self.postMessage(m);
  try {
    const result = autoSync(e.data, (fraction, stage) => post({ type: 'progress', fraction, stage }));
    delete result.stages; // diagnostics only
    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
