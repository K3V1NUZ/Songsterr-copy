// UI-facing player state. The PlayerController writes it; components read it.
import { create } from 'zustand';
import type { EngineState, SpeedTrainer } from '@/audio/AudioEngine';
import type { AudioMode } from './AlphaTabView';

export interface ChannelState {
  volume: number;
  muted: boolean;
  solo: boolean;
}

interface PlayerState {
  mode: AudioMode;
  ready: boolean;
  state: EngineState;
  positionMs: number;
  durationMs: number;
  speed: number;
  metronome: boolean;
  countInBars: number;
  countIn: { beat: number; of: number } | null;
  loop: { startMs: number; endMs: number } | null;
  loopCount: number;
  trainer: SpeedTrainer;
  channels: Record<string, ChannelState>;
  error: string;
  /** Bumped whenever the controller has (re)built the score timeline. */
  scoreVersion: number;
  reset: (mode: AudioMode) => void;
  setChannel: (id: string, patch: Partial<ChannelState>) => void;
}

const initial = {
  ready: false,
  state: 'stopped' as EngineState,
  positionMs: 0,
  durationMs: 0,
  speed: 1,
  metronome: false,
  countInBars: 0,
  countIn: null,
  loop: null,
  loopCount: 0,
  trainer: { enabled: false, step: 0.05, everyLoops: 2, target: 1 },
  channels: {},
  error: '',
  scoreVersion: 0,
};

export const usePlayer = create<PlayerState>()((set) => ({
  mode: 'synth',
  ...initial,
  reset: (mode) => set((s) => ({ mode, ...initial, scoreVersion: s.scoreVersion })),
  setChannel: (id, patch) =>
    set((s) => ({ channels: { ...s.channels, [id]: { volume: id === 'metronome' ? 0.7 : 1, muted: false, solo: false, ...s.channels[id], ...patch } } })),
}));
