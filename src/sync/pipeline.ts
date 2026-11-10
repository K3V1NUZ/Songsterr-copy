// The whole auto-sync analysis as one pure function: onset -> tempo -> beatTracker -> align.
// Runs inside sync.worker.ts in the app and directly in unit tests.
import { align } from './align';
import { fitToLocks } from './anchors';
import { localBpm, trackBeats } from './beatTracker';
import { onsetCurve, SAMPLE_RATE } from './onset';
import { periodCurve, refineSections, tempoSections, type TempoSection } from './tempo';
import type { Anchor, ScoreBeat, ScoreOnset, SyncWarning } from './types';

export interface AnalyzeInput {
  /** Mono PCM at SAMPLE_RATE. */
  samples: Float32Array;
  sampleRate: number;
  scoreBeats: ScoreBeat[];
  onsets: ScoreOnset[];
  /** Recording tempo / written tempo (from the BPM the user entered). 1 = as written. */
  tempoScale?: number;
  /** Beat tracker tightness (α). */
  tightness?: number;
  /** Manual anchors: kept exactly, the analysis only fills in the beats between them (docs §8). */
  lockedAnchors?: Anchor[];
}

export interface AnalyzeResult {
  anchors: Anchor[];
  /** Local tempo at each anchor, beats per minute. */
  localBpm: number[];
  warnings: SyncWarning[];
  /** 0..1 for the whole song. */
  confidence: number;
  /** Detected beat times (seconds), for diagnostics. */
  detected: number[];
}

export type Stage = 'onset' | 'tempo' | 'beats' | 'align';
export type ProgressFn = (stage: Stage, pct: number) => void;

/** Rough start of the music: the first clear onset (the alignment refines it). */
function firstOnsetFrame(curve: Float32Array): number {
  for (let i = 0; i < curve.length; i++) if (curve[i]! > 2) return i;
  return 0;
}

function sectionIndex(sections: TempoSection[], j: number): number {
  let lo = 0, hi = sections.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sections[mid]!.startBeat <= j) lo = mid; else hi = mid - 1;
  }
  return lo;
}

export function analyze(input: AnalyzeInput, progress: ProgressFn = () => {}): AnalyzeResult {
  if (input.sampleRate !== SAMPLE_RATE) throw new Error(`Expected audio at ${SAMPLE_RATE} Hz, got ${input.sampleRate} Hz`);
  const beats = input.scoreBeats;
  if (!beats.length) return { anchors: [], localBpm: [], warnings: [], confidence: 0, detected: [] };

  progress('onset', 0);
  const curve = onsetCurve(input.samples, (pct) => progress('onset', pct));

  progress('tempo', 0);
  const startFrame = firstOnsetFrame(curve);
  const hinted = tempoSections(beats, input.tempoScale ?? 1);
  const { sections, warnings } = refineSections(curve, hinted, startFrame);
  progress('tempo', 1);

  progress('beats', 0);
  const detected = trackBeats(curve, periodCurve(sections, startFrame, curve.length), { tightness: input.tightness ?? 100 });
  progress('beats', 1);

  progress('align', 0);
  const scale = input.tempoScale ?? 1;
  const locked = (input.lockedAnchors ?? []).filter((a) => a.source === 'manual');
  const res = align({
    beats, onsets: input.onsets, detected, curve, locked,
    // the beat's written length, sped up or slowed down like its tempo section
    periodOf: (j) => {
      const k = sectionIndex(sections, j);
      return (beats[Math.max(0, Math.min(beats.length - 1, j))]!.seconds / scale) * (hinted[k]!.bpm / sections[k]!.bpm);
    },
  });
  const anchors = fitToLocks(res.anchors, locked);
  if (res.ambiguousStart && !locked.length) {
    warnings.push({ code: 'LOW_CONFIDENCE_START', detail: 'Not sure where bar 1 starts in the recording. Please check it.' });
  }
  // mostly: are the score's notes heard where the anchors put them? (wrong audio scores low)
  const meanAnchor = anchors.reduce((s, a) => s + a.confidence, 0) / (anchors.length || 1);
  const confidence = Math.max(0, Math.min(1, 0.8 * res.noteFit + 0.2 * meanAnchor - (res.ambiguousStart && !locked.length ? 0.1 : 0)));
  progress('align', 1);
  return {
    anchors,
    localBpm: localBpm(anchors.map((a) => a.time)),
    warnings,
    confidence: Math.round(confidence * 100) / 100,
    detected: detected.map((d) => d.time),
  };
}

