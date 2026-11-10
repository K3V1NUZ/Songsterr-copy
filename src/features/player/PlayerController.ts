// Connects alphaTab (rendering, cursor, selection) with playback.
//   media mode: our AudioEngine plays the recording + stems; alphaTab runs in
//               external-media mode and its cursor follows the engine's clock.
//   synth mode: no recording; alphaTab's own synthesizer plays the score.
// The UI only talks to this controller.
import type { AlphaTabApi, model, synth } from '@coderline/alphatab';
import { AudioEngine, MAIN, METRONOME, type EngineState } from '@/audio/AudioEngine';
import type { SyncPoint } from '@/data/types';
import { scoreTimingFromAlphaTab } from '@/sync/fromAlphaTab';
import { createSyncMap, type SyncMap } from '@/sync/syncMap';
import { buildTimeline, countPattern, metronomeClicks, TICKS_PER_QUARTER, type Timeline } from '@/sync/timeline';
import type { AudioMode } from './AlphaTabView';
import { usePlayer } from './playerStore';

export class PlayerController {
  readonly engine: AudioEngine | null;
  private api: AlphaTabApi | null = null;
  private timeline: Timeline | null = null;
  private syncMap: SyncMap | null = null;
  private syncPoints: SyncPoint[];
  private raf = 0;
  private lastUi = 0;
  private offs: Array<() => void> = [];

  constructor(readonly mode: AudioMode, syncPoints: SyncPoint[]) {
    this.syncPoints = syncPoints;
    this.engine = mode === 'media' ? new AudioEngine() : null;
    if (this.engine) {
      const e = this.engine;
      e.countInPattern = (ms) => this.countInAt(ms);
      this.offs.push(
        e.on('state', (s) => this.onEngineState(s)),
        e.on('speed', (x) => usePlayer.setState({ speed: x })),
        e.on('loop', (n) => usePlayer.setState({ loopCount: n })),
        e.on('countIn', (beat, of) => usePlayer.setState({ countIn: { beat, of } })),
        e.on('ended', () => { this.api?.pause(); this.pushPosition(0); }),
        e.on('error', (m) => usePlayer.setState({ error: `Audio: ${m}` })),
      );
    }
    usePlayer.getState().reset(mode);
  }

  // ---- wiring ----------------------------------------------------------------------------
  private apiOffs: Array<() => void> = [];

  /** Connects (or, with null, disconnects) an alphaTab API. Safe to call repeatedly. */
  attach(api: AlphaTabApi | null): void {
    this.apiOffs.forEach((off) => off());
    this.apiOffs = [];
    const prevOut = this.api?.player?.output as synth.IExternalMediaSynthOutput | undefined;
    if (prevOut && this.engine) prevOut.handler = undefined;
    this.api = api;
    if (!api) return;
    if (this.engine) {
      const engine = this.engine;
      // alphaTab calls these when the user presses play, clicks a note, changes speed…
      const handler: synth.IExternalMediaHandler = {
        get backingTrackDuration() { return engine.durationMs; },
        get playbackRate() { return engine.speed; },
        set playbackRate(v: number) { engine.setSpeed(v); },
        get masterVolume() { return 1; },
        set masterVolume(_v: number) { /* the mixer owns volume */ },
        seekTo: (ms: number) => { engine.seek(ms); this.pushPosition(ms); },
        play: () => { void engine.play(); },
        pause: () => engine.pause(),
      };
      const attachHandler = () => {
        const out = api.player?.output as synth.IExternalMediaSynthOutput | undefined;
        if (out) out.handler = handler;
      };
      attachHandler();
      this.apiOffs.push(api.playerReady.on(attachHandler));
    } else {
      this.apiOffs.push(
        api.playerStateChanged.on((e) => usePlayer.setState({ state: e.state === 1 ? 'playing' : 'paused' })),
        api.playerPositionChanged.on((e) => usePlayer.setState({ positionMs: e.currentTime, durationMs: e.endTime })),
        api.playerReady.on(() => usePlayer.setState({ ready: true })),
      );
      if (api.isReadyForPlayback) usePlayer.setState({ ready: true });
    }
    this.apiOffs.push(
      api.scoreLoaded.on((score) => this.onScore(score)),
      api.playbackRangeChanged.on((e) => this.onRange(e.playbackRange)),
    );
    // the score may already be loaded when we attach
    if (api.score) this.onScore(api.score);
  }

  private onScore(score: model.Score): void {
    if (this.syncPoints.length) {
      score.applyFlatSyncPoints(this.syncPoints);
      this.api?.updateSyncPoints();
    }
    this.timeline = buildTimeline(scoreTimingFromAlphaTab(score));
    this.syncMap = createSyncMap(this.timeline, this.syncPoints);
    this.updateClicks();
    usePlayer.setState((s) => ({ scoreVersion: s.scoreVersion + 1 }));
    if (this.engine) usePlayer.setState({ durationMs: Math.max(this.engine.durationMs, 0), ready: this.engine.hasAudio });
  }

  private updateClicks(): void {
    if (!this.engine || !this.timeline || !this.syncMap) return;
    const map = this.syncMap;
    // one click per score beat, wherever the sync puts it (docs/SYNC_ENGINE.md §7)
    this.engine.setClicks(metronomeClicks(this.timeline).map((c) => ({ ms: map.beatToMs(c.beat), accent: c.accent })));
  }

  /** Count-in tempo and length at a recording position. */
  private countInAt(ms: number): { intervalMs: number; count: number } {
    if (!this.timeline || !this.syncMap) return { intervalMs: 500, count: 4 };
    const loc = this.syncMap.locate(Math.max(0, ms));
    const p = this.timeline.played[loc.playedIndex]!;
    const { stepQuarters, count } = countPattern(p.timeSignature);
    const intervalMs = this.syncMap.beatToMs(loc.beat + stepQuarters) - this.syncMap.beatToMs(loc.beat);
    return { intervalMs: intervalMs > 50 ? intervalMs : 500, count };
  }

  // ---- sources (media mode) --------------------------------------------------------------
  async setRecording(blob: Blob): Promise<void> {
    if (!this.engine) return;
    await this.engine.setMain(blob);
    usePlayer.setState({ durationMs: this.engine.durationMs, ready: true });
  }
  async addStem(id: string, blob: Blob): Promise<void> {
    await this.engine?.addStem(id, blob);
  }

  // ---- transport ---------------------------------------------------------------------------
  play(): void {
    if (this.engine) {
      // alphaTab forwards play() to the engine through the external-media handler
      if (this.api) this.api.play(); else void this.engine.play();
    } else this.api?.play();
  }
  pause(): void {
    if (this.engine) { this.engine.pause(); this.api?.pause(); } else this.api?.pause();
  }
  toggle(): void {
    const s = usePlayer.getState().state;
    if (s === 'playing' || s === 'counting-in') this.pause(); else this.play();
  }
  seek(ms: number): void {
    if (this.engine) { this.engine.seek(ms); this.pushPosition(ms); }
    else if (this.api) this.api.timePosition = ms;
  }
  setSpeed(speed: number): void {
    const x = Math.max(0.25, Math.min(1.5, Math.round(speed * 100) / 100));
    if (this.engine) this.engine.setSpeed(x);
    if (this.api) this.api.playbackSpeed = x;
    usePlayer.setState({ speed: x });
  }
  setMetronome(on: boolean): void {
    if (this.engine) this.engine.metronomeOn = on;
    else if (this.api) this.api.metronomeVolume = on ? 1 : 0;
    usePlayer.setState({ metronome: on });
  }
  setCountIn(bars: number): void {
    if (this.engine) this.engine.countInBars = bars;
    else if (this.api) this.api.countInVolume = bars > 0 ? 1 : 0; // alphaTab's synth counts in one bar
    usePlayer.setState({ countInBars: bars });
  }
  setTrainer(t: Partial<AudioEngine['trainer']>): void {
    if (this.engine) this.engine.trainer = { ...this.engine.trainer, ...t };
    usePlayer.setState((s) => ({ trainer: { ...s.trainer, ...t } }));
  }
  clearLoop(): void {
    this.api?.clearPlaybackRangeHighlight();
    if (this.api) this.api.playbackRange = null;
    this.onRange(null);
  }

  private onRange(range: { startTick: number; endTick: number } | null): void {
    if (!range) {
      this.engine?.setLoop(null);
      if (this.api) this.api.isLooping = false;
      usePlayer.setState({ loop: null, loopCount: 0 });
      return;
    }
    if (this.engine && this.syncMap) {
      const startMs = this.syncMap.beatToMs(range.startTick / TICKS_PER_QUARTER);
      const endMs = this.syncMap.beatToMs(range.endTick / TICKS_PER_QUARTER);
      this.engine.setLoop({ startMs, endMs });
      // our engine loops; alphaTab only shows the selection
      if (this.api) this.api.isLooping = false;
      usePlayer.setState({ loop: { startMs, endMs }, loopCount: 0 });
    } else if (this.api) {
      this.api.isLooping = true;
      usePlayer.setState({ loop: { startMs: 0, endMs: 0 }, loopCount: 0 });
    }
  }

  // ---- mixer ----------------------------------------------------------------------------------
  setVolume(id: string, v: number): void {
    if (id === 'synth' && this.api) this.api.masterVolume = v;
    this.engine?.setVolume(id, v);
    usePlayer.getState().setChannel(id, { volume: v });
  }
  setMuted(id: string, muted: boolean): void {
    if (id === 'synth' && this.api) this.api.masterVolume = muted ? 0 : usePlayer.getState().channels[id]?.volume ?? 1;
    this.engine?.setMuted(id, muted);
    usePlayer.getState().setChannel(id, { muted });
  }
  setSolo(id: string, solo: boolean): void {
    this.engine?.setSolo(id, solo);
    usePlayer.getState().setChannel(id, { solo });
  }

  /** Mute/solo a score part: its backing track (recording mode) or its synth track (no recording). */
  setPartMuted(trackIndex: number, muted: boolean, stemIds: string[]): void {
    if (this.engine) stemIds.forEach((id) => this.setMuted(id, muted));
    else { const t = this.api?.score?.tracks[trackIndex]; if (t) this.api?.changeTrackMute([t], muted); }
  }
  setPartSolo(trackIndex: number, solo: boolean, stemIds: string[]): void {
    if (this.engine) stemIds.forEach((id) => this.setSolo(id, solo));
    else { const t = this.api?.score?.tracks[trackIndex]; if (t) this.api?.changeTrackSolo([t], solo); }
  }

  // ---- clock → cursor ---------------------------------------------------------------------------
  private onEngineState(s: EngineState): void {
    usePlayer.setState({ state: s, ...(s !== 'counting-in' ? { countIn: null } : {}) });
    cancelAnimationFrame(this.raf);
    if (s === 'playing') {
      const loop = () => {
        this.pushPosition(this.engine!.positionMs());
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    } else if (this.engine) this.pushPosition(this.engine.positionMs());
  }

  private pushPosition(ms: number): void {
    const out = this.api?.player?.output as synth.IExternalMediaSynthOutput | undefined;
    // alphaTab stops playback when it sees the end of a selected range; the engine does
    // the looping (and the speed trainer), so alphaTab never gets to see the range end
    const loop = this.engine?.loop;
    out?.updatePosition(loop && ms >= loop.endMs - 2 ? loop.endMs - 2 : ms);
    const now = performance.now();
    if (now - this.lastUi > 100 || usePlayer.getState().state !== 'playing') {
      this.lastUi = now;
      usePlayer.setState({ positionMs: ms });
    }
  }

  /** Jumps `delta` bars forward/back from the current position (in played order). */
  seekBars(delta: number): void {
    if (!this.timeline || !this.syncMap) return;
    const now = this.engine ? this.engine.positionMs() : (this.api?.timePosition ?? 0);
    const loc = this.syncMap.locate(now);
    // "back" from the middle of a bar first goes to that bar's start
    const target = delta < 0 && loc.barPosition > 0.15 ? loc.playedIndex + delta + 1 : loc.playedIndex + delta;
    const p = this.timeline.played[Math.max(0, Math.min(this.timeline.played.length - 1, target))]!;
    if (this.engine) this.seek(Math.max(0, this.syncMap.beatToMs(p.startBeat)));
    else if (this.api) this.api.tickPosition = p.startBeat * TICKS_PER_QUARTER;
  }

  /** Replaces the sync points live: alphaTab's cursor, the metronome and loops follow at once. */
  setSyncPoints(points: SyncPoint[]): void {
    this.syncPoints = points;
    const score = this.api?.score;
    if (score) {
      score.applyFlatSyncPoints(points);
      this.api?.updateSyncPoints();
    }
    if (this.timeline) this.syncMap = createSyncMap(this.timeline, points);
    this.updateClicks();
    const loop = usePlayer.getState().loop;
    if (loop && this.api?.playbackRange) this.onRange(this.api.playbackRange);
    if (this.engine) this.pushPosition(this.engine.positionMs());
  }

  get scoreTimeline(): Timeline | null {
    return this.timeline;
  }
  get currentSyncMap(): SyncMap | null {
    return this.syncMap;
  }
  get alphaTab(): AlphaTabApi | null {
    return this.api;
  }

  /** Snapshot for tests/debugging: recording ms, alphaTab's cursor tick, and our own mapping. */
  debugState() {
    const ms = this.engine ? this.engine.positionMs() : (this.api?.timePosition ?? 0);
    return {
      ms,
      alphaTabBeat: (this.api?.tickPosition ?? 0) / TICKS_PER_QUARTER,
      ourBeat: this.syncMap?.msToBeat(ms) ?? 0,
      state: usePlayer.getState().state,
      loop: this.engine?.loop ?? null,
    };
  }

  /** Where the score is at a recording time (used by tests and the sync tool). */
  locate(ms: number) {
    return this.syncMap?.locate(ms) ?? null;
  }

  destroy(): void {
    this.attach(null);
    cancelAnimationFrame(this.raf);
    this.offs.forEach((f) => f());
    this.engine?.destroy();
  }
}

export const CHANNEL_MAIN = MAIN;
export const CHANNEL_METRONOME = METRONOME;
