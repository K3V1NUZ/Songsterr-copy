// Playback engine. One "score clock" drives everything:
//  - audio mode: the <audio> element is the master clock (your MP3), mapped to
//    score time through the sync map (offset / sync anchors)
//  - synth mode: the AudioContext clock is the master
// Synth notes and metronome clicks are scheduled ahead of time in both modes,
// so you can hear the tab on top of the recording to check the sync.
import { pluck, deadNote, click, drum } from './ks.js';
import { buildTimeline, buildNoteEvents, buildClicks, makeSyncMap, clickPattern, playedAt } from './timeline.js';

export class Engine {
  constructor() {
    this.ctx = null;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.preservesPitch = true;
    this.hasAudio = false;
    this.speed = 1;
    this.playing = false;
    this.countingIn = false;
    this.opts = { useAudio: true, synth: true, metronome: false, countIn: true, audioVolume: 1, synthVolume: 0.8 };
    this.trackState = []; // {mute, solo}
    this.loop = null; // {start, end} score seconds
    this.cache = new Map();
    this.listeners = {};
    this._timer = null;
    this._pos = 0; // score time when paused
    this.audio.addEventListener('ended', () => { if (this.playing) this.pause(); this.emit('ended'); });
    this.audio.addEventListener('loadedmetadata', () => this.emit('audioready'));
  }
  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, ...a) { (this.listeners[ev] || []).forEach((f) => f(...a)); }

  ensureCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
      this.synthBus = this.ctx.createGain(); this.synthBus.connect(this.master);
      this.clickBus = this.ctx.createGain(); this.clickBus.gain.value = 0.7; this.clickBus.connect(this.master);
      this.synthBus.gain.value = this.opts.synthVolume;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  load(song, audioUrl) {
    this.stop();
    this.song = song;
    this.tl = buildTimeline(song);
    this.events = buildNoteEvents(this.tl, song);
    this.clicks = buildClicks(this.tl);
    this.sync = makeSyncMap(this.tl, song.meta);
    this.trackState = song.tracks.map(() => ({ mute: false, solo: false }));
    this.loop = null;
    this._pos = 0;
    this.hasAudio = !!audioUrl;
    if (audioUrl) { this.audio.src = audioUrl; this.audio.load(); }
    else { this.audio.removeAttribute('src'); this.audio.load(); }
  }
  // re-read meta.sync / offset without reloading audio
  updateSync() { this.sync = makeSyncMap(this.tl, this.song.meta); }

  get audioMode() { return this.hasAudio && this.opts.useAudio; }
  get duration() {
    if (this.audioMode && isFinite(this.audio.duration)) return Math.max(this.tl.duration, this.sync.toScore(this.audio.duration));
    return this.tl.duration;
  }

  // ---- clock -----------------------------------------------------------
  scoreTime() {
    if (!this.playing) return this._pos;
    if (this.audioMode) {
      if (this._fakeStart && this.audio.paused) return this._fakeStart.score + (this.ctx.currentTime - this._fakeStart.ctx) * this.speed;
      return this.sync.toScore(this.audio.currentTime);
    }
    return this._startScore + (this.ctx.currentTime - this._startCtx) * this.speed;
  }
  // real seconds (ctx time) until score time s happens
  _delayTo(s, now) {
    if (this.audioMode) return (this.sync.toAudio(s) - this.audio.currentTime) / this.audio.playbackRate;
    return (s - now) / this.speed;
  }

  setSpeed(x) {
    const pos = this.scoreTime();
    this.speed = x;
    this.audio.playbackRate = x;
    if (this.playing && !this.audioMode) { this._startScore = pos; this._startCtx = this.ctx.currentTime; this._resetCursors(pos); }
  }

  // ---- transport -------------------------------------------------------
  async play() {
    if (this.playing || this.countingIn) return;
    const ctx = this.ensureCtx();
    let pos = this._pos;
    if (this.loop && (pos < this.loop.start || pos >= this.loop.end)) pos = this.loop.start;
    if (pos >= this.tl.duration - 0.01 && !this.audioMode) pos = 0;
    this._pos = pos;
    let lead = 0;
    if (this.opts.countIn) lead = this._countIn(pos);
    this.countingIn = lead > 0;
    this.emit('state');
    const begin = () => {
      this.countingIn = false;
      if (this.audioMode) {
        const at = this.sync.toAudio(pos);
        if (at < 0) {
          // tab starts before the audio: hold until audio time 0
          this.audio.currentTime = 0;
          this._holdTimer = setTimeout(() => { if (this.playing) this.audio.play(); }, (-at / this.speed) * 1000);
          this._fakeStart = { ctx: ctx.currentTime, score: pos };
        } else { this._fakeStart = null; this.audio.currentTime = at; this.audio.play().catch((e) => this.emit('error', e)); }
        this.audio.playbackRate = this.speed;
      } else {
        this._startScore = pos;
        this._startCtx = ctx.currentTime;
      }
      this.playing = true;
      this._resetCursors(pos);
      this._tick();
      this._timer = setInterval(() => this._tick(), 25);
      this.emit('state');
    };
    if (lead > 0) {
      if (!this.audioMode) {
        // sample-accurate: the score clock starts exactly when the count-in ends
        this._startScore = pos; this._startCtx = ctx.currentTime + lead;
        this._countTimer = setTimeout(() => { begin(); this._startCtx = this._countInEnd; }, lead * 1000 - 5);
      } else this._countTimer = setTimeout(begin, lead * 1000);
    } else begin();
  }

  _countIn(pos) {
    const pb = this.tl.played[Math.max(0, playedAt(this.tl, pos))];
    if (!pb) return 0;
    const { stepQ, count } = clickPattern(pb.time);
    const step = (stepQ * pb.spq) / this.speed;
    const t0 = this.ctx.currentTime + 0.08;
    for (let i = 0; i < count; i++) {
      this._playBuffer(this._click(i === 0), t0 + i * step, this.clickBus, 1);
      setTimeout(() => this.emit('countin', i + 1, count), (0.08 + i * step) * 1000);
    }
    this._countInEnd = t0 + count * step;
    return 0.08 + count * step;
  }

  pause() {
    if (this.countingIn) { clearTimeout(this._countTimer); this.countingIn = false; this.emit('countin', 0, 0); this.emit('state'); return; }
    if (!this.playing) return;
    this._pos = this.scoreTime();
    this.playing = false;
    clearInterval(this._timer); clearTimeout(this._holdTimer);
    this.audio.pause();
    this._stopVoices();
    this.emit('state');
    this.emit('paused');
  }
  stop() { this.pause(); this._pos = this.loop ? this.loop.start : 0; this.emit('seek'); }
  toggle() { (this.playing || this.countingIn) ? this.pause() : this.play(); }

  seek(s) {
    s = Math.max(0, Math.min(s, this.duration));
    const wasPlaying = this.playing;
    if (wasPlaying) {
      this._stopVoices();
      if (this.audioMode) {
        const at = this.sync.toAudio(s);
        this.audio.currentTime = Math.max(0, at);
      } else { this._startScore = s; this._startCtx = this.ctx.currentTime; }
      this._resetCursors(s);
    } else this._pos = s;
    this.emit('seek');
  }

  setLoop(start, end) { this.loop = start == null ? null : { start, end }; this.emit('state'); }

  // ---- scheduler -------------------------------------------------------
  _resetCursors(s) {
    const firstIdx = (arr) => { let i = 0; while (i < arr.length && arr[i].t < s - 0.001) i++; return i; };
    this._ei = firstIdx(this.events);
    this._ci = firstIdx(this.clicks);
  }
  _tick() {
    if (!this.playing) return;
    if (this._fakeStart && !this.audio.paused) this._fakeStart = null;
    const now = this.scoreTime();
    if (this.loop && now >= this.loop.end) { this.seek(this.loop.start); return; }
    if (!this.audioMode && now >= this.tl.duration + 0.5) { this.pause(); this._pos = 0; this.emit('ended'); return; }
    const horizon = now + 0.15 * this.speed;
    const ctxNow = this.ctx.currentTime;
    const anySolo = this.trackState.some((t) => t.solo);
    if (this.opts.synth) {
      while (this._ei < this.events.length && this.events[this._ei].t < horizon) {
        const ev = this.events[this._ei++];
        if (ev.t < now - 0.03) continue;
        if (this.loop && ev.t >= this.loop.end) continue;
        const ts = this.trackState[ev.track];
        if (ts.mute || (anySolo && !ts.solo)) continue;
        const when = ctxNow + Math.max(0, this._delayTo(ev.t, now));
        this._playNote(ev, when);
      }
    } else this._ei = this.events.length;
    while (this._ci < this.clicks.length && this.clicks[this._ci].t < horizon) {
      const c = this.clicks[this._ci++];
      if (!this.opts.metronome || c.t < now - 0.03) continue;
      this._playBuffer(this._click(c.accent), ctxNow + Math.max(0, this._delayTo(c.t, now)), this.clickBus, 1);
    }
  }

  // ---- sound -----------------------------------------------------------
  _buf(key, gen) {
    let b = this.cache.get(key);
    if (!b) {
      const data = gen(this.ctx.sampleRate);
      b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
      b.copyToChannel(data, 0);
      this.cache.set(key, b);
    }
    return b;
  }
  _click(accent) { return this._buf('click' + accent, (sr) => click(sr, accent)); }
  _playBuffer(buf, when, bus, gain, rate = 1) {
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.playbackRate.value = rate;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(g).connect(bus);
    src.start(when);
    return { src, g };
  }
  _playNote(ev, when) {
    const track = this.song.tracks[ev.track];
    const inst = track.instrument;
    const n = ev.note;
    let v;
    const vel = (n.ghost ? 0.35 : n.accent ? 1 : 0.75) * (ev.legato ? 0.6 : 1) * track.volume;
    if (inst === 'drums') {
      v = this._playBuffer(this._buf('drum' + n.drum, (sr) => drum(n.drum, sr)), when, this.synthBus, vel);
    } else if (n.dead) {
      v = this._playBuffer(this._buf('dead', deadNote), when, this.synthBus, vel * 0.8);
    } else {
      const mute = !!n.palmMute;
      const key = `${inst}:${ev.midi}:${mute}`;
      const buf = this._buf(key, (sr) => pluck(ev.midi, sr, { instrument: inst, mute }));
      v = this._playBuffer(buf, when, this.synthBus, vel * (inst === 'bass' ? 1.1 : 0.55));
      const realDur = ev.dur / this.speed;
      const rate = v.src.playbackRate;
      if (n.bend) {
        rate.setValueAtTime(1, when);
        rate.linearRampToValueAtTime(Math.pow(2, n.bend / 12), when + Math.min(0.25, realDur * 0.5));
      }
      if (ev.slideTo != null) {
        rate.setValueAtTime(1, when + realDur * 0.5);
        rate.linearRampToValueAtTime(Math.pow(2, (ev.slideTo - ev.midi) / 12), when + realDur * 0.95);
      }
      if (n.vibrato) {
        const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
        lfo.frequency.value = 5.5; lg.gain.value = 0.006;
        lfo.connect(lg).connect(rate); lfo.start(when + 0.1); lfo.stop(when + realDur + 0.3);
      }
      // release at the end of the written duration (with a short tail)
      const end = when + Math.max(0.08, realDur) + 0.04;
      v.g.gain.setValueAtTime(v.g.gain.value, end);
      v.g.gain.linearRampToValueAtTime(0, end + 0.12);
      v.src.stop(end + 0.15);
    }
    (this._voices ||= new Set()).add(v.src);
    v.src.onended = () => this._voices.delete(v.src);
  }
  _stopVoices() {
    if (!this._voices) return;
    const t = this.ctx ? this.ctx.currentTime : 0;
    for (const s of this._voices) { try { s.stop(t + 0.01); } catch { /* already stopped */ } }
    this._voices.clear();
  }
  setSynthVolume(v) { this.opts.synthVolume = v; if (this.synthBus) this.synthBus.gain.value = v; }
  setAudioVolume(v) { this.opts.audioVolume = v; this.audio.volume = v; }
}
