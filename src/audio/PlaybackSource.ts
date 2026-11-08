// One audio file in the mixer (the recording or a stem).
//
// This is the swappable piece for time-stretching: MediaElementSource uses the
// browser's built-in pitch-preserving playback; a SoundTouch/AudioWorklet
// implementation can replace it later without touching the engine.

export interface PlaybackSource {
  readonly id: string;
  /** Connect this to a channel gain. */
  readonly output: AudioNode;
  readonly durationMs: number;
  /** Resolves once the file is decoded enough to play. */
  readonly ready: Promise<void>;
  currentMs(): number;
  isPlaying(): boolean;
  play(): Promise<void>;
  pause(): void;
  seek(ms: number): void;
  /** Playback speed, pitch preserved. */
  setRate(rate: number): void;
  destroy(): void;
}

export class MediaElementSource implements PlaybackSource {
  readonly id: string;
  readonly output: AudioNode;
  readonly ready: Promise<void>;
  private readonly el: HTMLAudioElement;
  private readonly url: string;
  private readonly node: MediaElementAudioSourceNode;

  constructor(ctx: AudioContext, id: string, blob: Blob) {
    this.id = id;
    this.url = URL.createObjectURL(blob);
    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.preservesPitch = true;
    this.el.src = this.url;
    this.node = ctx.createMediaElementSource(this.el);
    this.output = this.node;
    this.ready = new Promise((resolve, reject) => {
      if (this.el.readyState >= 1) return resolve();
      this.el.addEventListener('loadedmetadata', () => resolve(), { once: true });
      this.el.addEventListener('error', () => reject(new Error(`Could not decode audio "${id}"`)), { once: true });
    });
  }

  get durationMs(): number {
    return Number.isFinite(this.el.duration) ? this.el.duration * 1000 : 0;
  }
  currentMs(): number {
    return this.el.currentTime * 1000;
  }
  isPlaying(): boolean {
    return !this.el.paused;
  }
  async play(): Promise<void> {
    await this.el.play();
  }
  pause(): void {
    this.el.pause();
  }
  seek(ms: number): void {
    this.el.currentTime = Math.max(0, Math.min(ms, this.durationMs || ms)) / 1000;
  }
  setRate(rate: number): void {
    this.el.playbackRate = rate;
  }
  destroy(): void {
    this.el.pause();
    this.node.disconnect();
    this.el.removeAttribute('src');
    this.el.load();
    URL.revokeObjectURL(this.url);
  }
}
