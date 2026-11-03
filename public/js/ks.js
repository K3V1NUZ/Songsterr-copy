// Pure sample generators (no Web Audio dependency) so the browser and the
// Node WAV renderer produce the same sounds.

export const midiFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Karplus-Strong plucked string.
export function pluck(midi, sr, { seconds = 2.2, bright = 0.5, decay = 0.996, mute = false, instrument = 'guitar' } = {}) {
  const f = midiFreq(midi);
  if (instrument === 'bass') { bright = 0.25; decay = 0.997; seconds = 2.6; }
  if (instrument === 'distortion' || instrument === 'electric') { bright = 0.65; decay = 0.998; }
  if (instrument === 'acoustic') { bright = 0.6; }
  if (instrument === 'ukulele' || instrument === 'banjo') { bright = 0.7; decay = 0.992; seconds = 1.4; }
  if (mute) { decay = 0.93; seconds = 0.35; bright = 0.25; }
  const n = Math.floor(sr * seconds);
  const out = new Float32Array(n);
  const P = sr / f - 0.5;
  const L = Math.ceil(P) + 2;
  // excitation: filtered noise burst
  let lp = 0;
  for (let i = 0; i < L && i < n; i++) {
    const r = Math.random() * 2 - 1;
    lp = lp + bright * (r - lp);
    out[i] = lp;
  }
  // per-sample decay tuned so low notes don't ring forever and high ones don't die instantly
  const fdec = Math.pow(decay, 440 / Math.max(f, 60) * 0.35 + 0.65);
  for (let i = L; i < n; i++) {
    const pos = i - P;
    const i0 = Math.floor(pos), fr = pos - i0;
    const a = out[i0] * (1 - fr) + out[i0 + 1] * fr;
    const b = out[i0 - 1] * (1 - fr) + out[i0] * fr;
    out[i] = fdec * 0.5 * (a + b);
  }
  // DC removal + gentle fade-out
  let prevIn = 0, prevOut = 0;
  for (let i = 0; i < n; i++) {
    const x = out[i];
    const y = x - prevIn + 0.995 * prevOut;
    prevIn = x; prevOut = y; out[i] = y;
  }
  const fade = Math.min(n, Math.floor(sr * 0.05));
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  if (instrument === 'distortion') {
    for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * 6) * 0.5;
  }
  if (instrument === 'keys') {
    // simple electric-piano-ish tone instead of a string
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      out[i] = (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)) * Math.exp(-t * 2.2) * 0.6;
    }
  }
  return out;
}

export function deadNote(sr) {
  const n = Math.floor(sr * 0.06), out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) { lp += 0.3 * ((Math.random() * 2 - 1) - lp); out[i] = lp * Math.exp(-i / (sr * 0.012)); }
  return out;
}

export function click(sr, accent) {
  const n = Math.floor(sr * 0.05), out = new Float32Array(n), f = accent ? 1800 : 1200;
  for (let i = 0; i < n; i++) out[i] = Math.sin(2 * Math.PI * f * i / sr) * Math.exp(-i / (sr * 0.008)) * (accent ? 0.9 : 0.6);
  return out;
}

export function drum(name, sr) {
  const rnd = () => Math.random() * 2 - 1;
  const mk = (sec) => new Float32Array(Math.floor(sr * sec));
  let out;
  if (name === 'kick') {
    out = mk(0.4); let ph = 0;
    for (let i = 0; i < out.length; i++) { const t = i / sr; ph += 2 * Math.PI * (45 + 110 * Math.exp(-t * 35)) / sr; out[i] = Math.sin(ph) * Math.exp(-t * 9); }
  } else if (name === 'snare' || name === 'sidestick') {
    out = mk(name === 'snare' ? 0.25 : 0.08); let ph = 0;
    for (let i = 0; i < out.length; i++) { const t = i / sr; ph += 2 * Math.PI * 190 / sr; out[i] = (0.5 * Math.sin(ph) * Math.exp(-t * 25) + 0.6 * rnd() * Math.exp(-t * 18)) * 0.8; }
  } else if (name.startsWith('tom')) {
    const base = { tom1: 200, tom2: 150, tom3: 100 }[name]; out = mk(0.45); let ph = 0;
    for (let i = 0; i < out.length; i++) { const t = i / sr; ph += 2 * Math.PI * (base * (1 + 0.5 * Math.exp(-t * 20))) / sr; out[i] = Math.sin(ph) * Math.exp(-t * 8); }
  } else {
    const sec = { hihat: 0.06, pedal: 0.05, ohat: 0.35, crash: 1.4, ride: 0.9 }[name] || 0.1;
    out = mk(sec); let prev = 0;
    for (let i = 0; i < out.length; i++) {
      const t = i / sr, x = rnd(); const hp = x - prev; prev = x; // crude high-pass
      const ring = name === 'ride' ? 0.3 * Math.sin(2 * Math.PI * 5200 * t) : 0;
      out[i] = (hp * 0.45 + ring) * Math.exp(-t * (3 / sec));
    }
  }
  return out;
}
