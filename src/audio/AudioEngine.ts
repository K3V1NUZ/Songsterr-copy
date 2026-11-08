// The Web Audio engine: plays the recording + stems through a mixer, keeps the
// stems locked to the recording, and schedules metronome / count-in clicks.
// The recording's clock is the master clock; alphaTab's cursor follows it.
import { MediaElementSource, type PlaybackSource } from './PlaybackSource';

export const MAIN = 'main';
export const METRONOME = 'metronome';

export interface ClickTime {
  /** Recording time of the click, ms. */
  ms: number;
  accent: boolean;
}

export interface CountIn {
  /** Recording ms between count-in clicks (at speed 1). */
  intervalMs: number;
  /** Clicks per bar. */
  count: number;
}

export interface LoopRange {
  startMs: number;
  endMs: number;
}

export interface SpeedTrainer {
  enabled: boolean;
  /** Raise the speed by this much (e.g. 0.05 = +5 %) ... */
  step: number;
  /** ... every this many loops ... */
  everyLoops: number;
  /** ... until this speed is reached. */
  target: number;
}

export type EngineState = 'stopped' | 'counting-in' | 'playing' | 'paused';

interface Channel {
  gain: GainNode;
  volume: number;
  muted: boolean;
}

type Events = {
  state: (state: EngineState) => void;
  /** Speed changed by the engine itself (speed trainer). */
  speed: (speed: number) => void;
  loop: (count: number) => void;
  countIn: (beat: number, of: number) => void;
  ended: () => void;
  error: (message: string) => void;
};

const LOOKAHEAD_MS = 25;
const HORIZON_S = 0.12;

export class AudioEngine {
  readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly channels = new Map<string, Channel>();
  private readonly solo = new Set<string>();
  private main: PlaybackSource | null = null;
  private stems = new Map<string, PlaybackSource>();
  private listeners = new Map<keyof Events, Set<(...args: never[]) => void>>();

  private _state: EngineState = 'stopped';
  private rate = 1;
  private pausedAt = 0;
  private clicks: ClickTime[] = [];
  private clickIdx = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private countInTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSync = 0;
  private smooth = { ms: 0, at: 0 };

  metronomeOn = false;
  countInBars = 0;
  countInPattern: (atMs: number) => CountIn = () => ({ intervalMs: 500, count: 4 });
  loop: LoopRange | null = null;
  loopCount = 0;
  trainer: SpeedTrainer = { enabled: false, step: 0.05, everyLoops: 2, target: 1 };

  constructor(ctx?: AudioContext) {
    this.ctx = ctx ?? new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.channel(METRONOME).volume = 0.7;
    this.applyGains();
  }

  // ---- events ----------------------------------------------------------------------
  on<K extends keyof Events>(ev: K, fn: Events[K]): () => void {
    let set = this.listeners.get(ev);
    if (!set) { set = new Set(); this.listeners.set(ev, set); }
    const s = set;
    s.add(fn);
    return () => { s.delete(fn); };
  }
  private emit<K extends keyof Events>(ev: K, ...args: Parameters<Events[K]>): void {
    this.listeners.get(ev)?.forEach((fn) => (fn as (...a: Parameters<Events[K]>) => void)(...args));
  }

  // ---- sources & mixer --------------------------------------------------------------
  private channel(id: string): Channel {
    let ch = this.channels.get(id);
    if (!ch) {
      const gain = this.ctx.createGain();
      gain.connect(this.master);
      ch = { gain, volume: 1, muted: false };
      this.channels.set(id, ch);
    }
    return ch;
  }

  async setMain(blob: Blob | null): Promise<void> {
    this.main?.destroy();
    this.main = null;
    if (!blob) return;
    const src = new MediaElementSource(this.ctx, MAIN, blob);
    src.output.connect(this.channel(MAIN).gain);
    src.setRate(this.rate);
    this.main = src;
    await src.ready;
  }

  async addStem(id: string, blob: Blob): Promise<void> {
    this.removeStem(id);
    const src = new MediaElementSource(this.ctx, id, blob);
    src.output.connect(this.channel(id).gain);
    src.setRate(this.rate);
    this.stems.set(id, src);
    await src.ready;
    src.seek(this.positionMs());
    if (this._state === 'playing') void src.play().catch(() => {});
    this.applyGains();
  }

  removeStem(id: string): void {
    this.stems.get(id)?.destroy();
    this.stems.delete(id);
  }

  get hasAudio(): boolean {
    return this.main !== null;
  }
  get durationMs(): number {
    return this.main?.durationMs ?? 0;
  }

  setVolume(id: string, volume: number): void {
    this.channel(id).volume = volume;
    this.applyGains();
  }
  setMuted(id: string, muted: boolean): void {
    this.channel(id).muted = muted;
    this.applyGains();
  }
  setSolo(id: string, on: boolean): void {
    if (on) this.solo.add(id); else this.solo.delete(id);
    this.applyGains();
  }
  private applyGains(): void {
    const t = this.ctx.currentTime;
    for (const [id, ch] of this.channels) {
      // the metronome is a practice aid: solo on audio channels never silences it
      const soloed = this.solo.size === 0 || this.solo.has(id) || id === METRONOME;
      const v = ch.muted || !soloed ? 0 : ch.volume;
      ch.gain.gain.setTargetAtTime(v, t, 0.015);
    }
  }

  // ---- clock ---------------------------------------------------------------------------
  get state(): EngineState {
    return this._state;
  }
  get speed(): number {
    return this.rate;
  }

  /** Current recording position in ms, smoothed between the media element's coarse updates. */
  positionMs(): number {
    if (this._state !== 'playing' || !this.main) return this.pausedAt;
    const raw = this.main.currentMs();
    const now = performance.now();
    const predicted = this.smooth.ms + (now - this.smooth.at) * this.rate;
    // follow the predicted value unless the media clock moved away from it
    const ms = Math.abs(predicted - raw) < 40 ? predicted : raw;
    this.smooth = { ms, at: now };
    return ms;
  }

  setClicks(clicks: ClickTime[]): void {
    this.clicks = [...clicks].sort((a, b) => a.ms - b.ms);
    this.resetClickIndex(this.positionMs());
  }

  // ---- transport ------------------------------------------------------------------------
  async play(): Promise<void> {
    if (!this.main || this._state === 'playing' || this._state === 'counting-in') return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    let from = this.pausedAt;
    if (this.loop && (from < this.loop.startMs || from >= this.loop.endMs)) from = this.loop.startMs;
    if (from >= this.durationMs - 10) from = this.loop?.startMs ?? 0;
    this.pausedAt = from;
    if (this.countInBars > 0) this.countIn(from);
    else await this.startMedia(from);
  }

  private countIn(from: number): void {
    const { intervalMs, count } = this.countInPattern(from);
    const step = intervalMs / this.rate / 1000;
    const total = count * this.countInBars;
    const t0 = this.ctx.currentTime + 0.05;
    for (let i = 0; i < total; i++) {
      this.click(t0 + i * step, i % count === 0);
      setTimeout(() => { if (this._state === 'counting-in') this.emit('countIn', (i % count) + 1, count); }, (0.05 + i * step) * 1000);
    }
    this.setState('counting-in');
    // start the media one click-interval after the last count-in click
    this.countInTimer = setTimeout(() => { void this.startMedia(from); }, (0.05 + total * step) * 1000 - 5);
  }

  private async startMedia(from: number): Promise<void> {
    if (!this.main) return;
    this.countInTimer = null;
    const sources = [this.main, ...this.stems.values()];
    for (const s of sources) { s.setRate(this.rate); s.seek(from); }
    this.smooth = { ms: from, at: performance.now() };
    this.resetClickIndex(from);
    try {
      await Promise.all(sources.map((s) => s.play()));
    } catch (e) {
      this.emit('error', e instanceof Error ? e.message : String(e));
      this.setState('paused');
      return;
    }
    this.setState('playing');
    this.timer ??= setInterval(() => this.tick(), LOOKAHEAD_MS);
  }

  pause(): void {
    if (this.countInTimer) { clearTimeout(this.countInTimer); this.countInTimer = null; }
    if (this._state === 'playing') this.pausedAt = this.positionMs();
    this.main?.pause();
    this.stems.forEach((s) => s.pause());
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.setState('paused');
  }

  toggle(): void {
    if (this._state === 'playing' || this._state === 'counting-in') this.pause(); else void this.play();
  }

  seek(ms: number): void {
    const to = Math.max(0, Math.min(ms, this.durationMs || ms));
    this.pausedAt = to;
    if (this._state === 'playing') {
      this.main?.seek(to);
      this.stems.forEach((s) => s.seek(to));
      this.smooth = { ms: to, at: performance.now() };
    }
    this.resetClickIndex(to);
  }

  setSpeed(rate: number): void {
    const pos = this.positionMs();
    this.rate = Math.max(0.25, Math.min(2, rate));
    this.main?.setRate(this.rate);
    this.stems.forEach((s) => s.setRate(this.rate));
    this.smooth = { ms: pos, at: performance.now() };
  }

  setLoop(range: LoopRange | null): void {
    this.loop = range && range.endMs > range.startMs ? range : null;
    this.loopCount = 0;
  }

  // ---- scheduler -------------------------------------------------------------------------
  private tick(): void {
    if (this._state !== 'playing' || !this.main) return;
    const pos = this.positionMs();
    if (this.loop && pos >= this.loop.endMs) { this.onLoopEnd(); return; }
    if (!this.main.isPlaying() && pos >= this.durationMs - 50) { this.pause(); this.pausedAt = 0; this.emit('ended'); return; }
    this.keepStemsInSync(pos);
    // metronome
    const horizon = pos + HORIZON_S * 1000 * this.rate;
    while (this.clickIdx < this.clicks.length && this.clicks[this.clickIdx]!.ms < horizon) {
      const c = this.clicks[this.clickIdx++]!;
      if (!this.metronomeOn || c.ms < pos - 20) continue;
      if (this.loop && c.ms >= this.loop.endMs) continue;
      this.click(this.ctx.currentTime + Math.max(0, (c.ms - pos) / this.rate / 1000), c.accent);
    }
  }

  private onLoopEnd(): void {
    this.loopCount++;
    const t = this.trainer;
    if (t.enabled && this.loopCount % t.everyLoops === 0 && this.rate < t.target - 1e-6) {
      this.setSpeed(Math.min(t.target, Math.round((this.rate + t.step) * 100) / 100));
      this.emit('speed', this.rate);
    }
    this.emit('loop', this.loopCount);
    this.seek(this.loop!.startMs);
  }

  /** Stems are separate media elements; nudge their speed (or jump) so they stay on the recording's clock. */
  private keepStemsInSync(pos: number): void {
    const now = performance.now();
    if (now - this.lastSync < 250 || !this.main) return;
    this.lastSync = now;
    const mainMs = this.main.currentMs();
    for (const s of this.stems.values()) {
      const drift = s.currentMs() - mainMs;
      if (Math.abs(drift) > 120) { s.seek(pos); s.setRate(this.rate); }
      else if (Math.abs(drift) > 12) s.setRate(this.rate * (1 - Math.max(-0.03, Math.min(0.03, drift / 1000))));
      else s.setRate(this.rate);
    }
  }

  private resetClickIndex(ms: number): void {
    let lo = 0;
    let hi = this.clicks.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.clicks[mid]!.ms < ms - 1) lo = mid + 1; else hi = mid; }
    this.clickIdx = lo;
  }

  /** A short synthesized click into the metronome channel. */
  private click(when: number, accent: boolean): void {
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1320;
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(accent ? 0.9 : 0.55, when + 0.002);
    env.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    osc.connect(env).connect(this.channel(METRONOME).gain);
    osc.start(when);
    osc.stop(when + 0.06);
  }

  private setState(s: EngineState): void {
    if (this._state === s) return;
    this._state = s;
    this.emit('state', s);
  }

  destroy(): void {
    this.pause();
    this.main?.destroy();
    this.stems.forEach((s) => s.destroy());
    this.stems.clear();
    void this.ctx.close();
  }
}
