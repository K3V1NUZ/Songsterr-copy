// The whole auto-sync analysis as one pure function: onset -> tempo -> beatTracker -> align.
// Runs inside sync.worker.ts in the app and directly in unit tests.
import { align } from './align';
import { fitToLocks, isLocked } from './anchors';
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


/** Audio kept before the bar "Sync from here" starts at, so the onset curve and the start search have context. */
const FROM_LEAD_SECONDS = 2;

export interface AnalyzeFromInput extends Omit<AnalyzeInput, 'lockedAnchors'> {
  /** The song's current anchors, one per score beat. */
  anchors: Anchor[];
  /** Score beat to sync from. It stays where it is; everything after it is synced again. */
  fromBeat: number;
}

/**
 * "Sync from here": the beats before `fromBeat` stay exactly as they are, the beat at `fromBeat` stays
 * where it is (pinned), and everything after it is synced again from the audio, keeping the pins after
 * it. Only the audio from just before that beat on is analysed, so nothing earlier in the song (a wrong
 * start, an intro) can pull the result off.
 */
export function analyzeFrom(input: AnalyzeFromInput, progress: ProgressFn = () => {}): AnalyzeResult {
  const { anchors: current, fromBeat: i } = input;
  const from = current[i];
  if (!from || current.length !== input.scoreBeats.length) throw new Error('Sync from here: the sync does not match the score');
  const sr = input.sampleRate;
  const cut = Math.max(0, Math.floor((from.time - FROM_LEAD_SECONDS) * sr));
  const offset = cut / sr;
  const beats = input.scoreBeats.slice(i).map((b) => ({ ...b, index: b.index - i }));
  const onsets = input.onsets.filter((o) => o.scoreBeat >= i - 1e-9).map((o) => ({ ...o, scoreBeat: o.scoreBeat - i }));
  const locked: Anchor[] = [
    { scoreBeat: 0, time: from.time - offset, source: 'manual', confidence: 1 },
    ...current.slice(i + 1).filter(isLocked).map((a) => ({ ...a, scoreBeat: a.scoreBeat - i, time: a.time - offset })),
  ];
  const res = analyze({ ...input, samples: input.samples.subarray(cut), scoreBeats: beats, onsets, lockedAnchors: locked }, progress);
  const after = res.anchors.slice(1).map((a) => ({ ...a, scoreBeat: a.scoreBeat + i, time: a.time + offset }));
  // the pins after it come back exactly as they were (no rounding through the offset)
  const pinned = new Map(current.slice(i + 1).filter(isLocked).map((a) => [a.scoreBeat, a] as const));
  const anchors = [...current.slice(0, i), { ...from, source: 'manual' as const, confidence: 1 }, ...after.map((a) => pinned.get(a.scoreBeat) ?? a)];
  return {
    ...res,
    anchors,
    localBpm: localBpm(anchors.map((a) => a.time)),
    warnings: res.warnings.filter((w) => w.code !== 'LOW_CONFIDENCE_START'),
    detected: res.detected.map((t) => t + offset),
  };
}
