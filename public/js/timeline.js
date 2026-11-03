// Timeline: turns a parsed song into a linear "performance" (repeats expanded),
// with score times in seconds, and maps score time <-> audio-file time
// using the song's offset / sync anchors.

export function buildTimeline(song) {
  const order = playOrder(song.masterBars);
  const played = []; // one entry per played bar
  let t = 0;
  order.forEach((barIndex, k) => {
    const mb = song.masterBars[barIndex];
    const spq = 60 / mb.tempo; // seconds per quarter
    const duration = mb.lengthQ * spq;
    played.push({ k, barIndex, start: t, duration, end: t + duration, spq, tempo: mb.tempo, time: mb.time });
    t += duration;
  });
  return { played, duration: t, song };
}

export function playOrder(bars) {
  const order = [];
  let start = 0, pass = 1, inEndings = false;
  let i = 0, guard = 0;
  while (i < bars.length && guard++ < 20000) {
    const b = bars[i];
    if (b.repeatStart && i !== start) { start = i; pass = 1; }
    if (b.ending) {
      inEndings = true;
      if (!b.ending.includes(pass)) { i++; continue; }
    } else if (inEndings) { inEndings = false; pass = 1; start = i; }
    order.push(i);
    if (b.repeatEnd) {
      const times = b.repeatTimes || 2;
      if (pass < times) { pass++; i = start; inEndings = false; continue; }
      pass = 1; start = i + 1; inEndings = false;
    }
    i++;
  }
  return order;
}

// Index of the played bar containing score time t.
export function playedAt(tl, t) {
  const p = tl.played;
  if (!p.length) return -1;
  if (t <= 0) return 0;
  let lo = 0, hi = p.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (p[mid].start <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

// ---- audio sync -----------------------------------------------------------
// anchors: [{bar (1-based played bar), time (seconds in audio file)}]
// Returns {toAudio(scoreT), toScore(audioT)} — piecewise-linear, extrapolated
// at both ends with the nearest segment's slope (slope 1 if only one anchor).
export function makeSyncMap(tl, meta) {
  let anchors = (meta.sync || []).filter((a) => a.bar >= 1 && a.bar <= tl.played.length + 1);
  if (!anchors.length) anchors = [{ bar: 1, time: meta.offset || 0 }];
  const pts = anchors
    .map((a) => ({ s: a.bar <= tl.played.length ? tl.played[a.bar - 1].start : tl.duration, a: a.time }))
    .sort((x, y) => x.s - y.s);
  // drop non-monotonic points
  const clean = [];
  for (const p of pts) {
    const last = clean[clean.length - 1];
    if (!last || (p.s > last.s && p.a > last.a)) clean.push(p);
  }
  const seg = (i) => {
    const a = clean[i], b = clean[i + 1];
    return (b.a - a.a) / (b.s - a.s);
  };
  const toAudio = (s) => {
    if (clean.length === 1) return clean[0].a + (s - clean[0].s);
    let i = 0;
    while (i < clean.length - 2 && s >= clean[i + 1].s) i++;
    return clean[i].a + (s - clean[i].s) * seg(i);
  };
  const toScore = (a) => {
    if (clean.length === 1) return clean[0].s + (a - clean[0].a);
    let i = 0;
    while (i < clean.length - 2 && a >= clean[i + 1].a) i++;
    return clean[i].s + (a - clean[i].a) / seg(i);
  };
  return { toAudio, toScore, points: clean };
}

// ---- events for the synth / metronome ------------------------------------
// Returns sorted note events: {t, dur, midi, track, note, beat, bend, slideTo, ...}
export function buildNoteEvents(tl, song) {
  const events = [];
  song.tracks.forEach((track, ti) => {
    for (const pb of tl.played) {
      const bar = track.bars[pb.barIndex];
      bar.beats.forEach((beat, bi) => {
        const t = pb.start + beat.pos * pb.spq;
        const d = beat.q * pb.spq;
        for (const note of beat.notes) {
          if (note.tie) {
            // extend the previous event on the same string
            for (let j = events.length - 1; j >= 0; j--) {
              const e = events[j];
              if (e.track === ti && e.string === note.string) { e.dur = Math.max(e.dur, t + d - e.t); break; }
            }
            continue;
          }
          const ev = { t, dur: d, midi: note.midi, track: ti, string: note.string, note, played: pb.k, beatIndex: bi };
          if (note.letRing) ev.dur = Math.max(d, 2.5);
          // legato/slide target: next note on the same string in this track
          if (note.slide || note.hammer || note.pull) {
            const nxt = findNextOnString(track, tl, pb.k, bi, note.string);
            if (nxt && note.slide) ev.slideTo = nxt.midi;
            if (nxt) nxt.legato = true;
          }
          events.push(ev);
        }
      });
    }
  });
  events.sort((a, b) => a.t - b.t);
  // mark legato attacks (notes reached by hammer/pull/slide)
  for (const e of events) if (e.note.legato) e.legato = true;
  return events;
}

function findNextOnString(track, tl, k, bi, string) {
  for (let kk = k; kk < Math.min(tl.played.length, k + 2); kk++) {
    const bar = track.bars[tl.played[kk].barIndex];
    for (let j = kk === k ? bi + 1 : 0; j < bar.beats.length; j++) {
      const n = bar.beats[j].notes.find((x) => x.string === string);
      if (n) return n;
    }
  }
  return null;
}

// Metronome clicks: one per beat of the time signature denominator
// (compound meters 6/8, 9/8, 12/8 click on dotted quarters).
export function buildClicks(tl) {
  const clicks = [];
  for (const pb of tl.played) {
    const [n, d] = pb.time;
    const compound = d === 8 && n % 3 === 0 && n > 3;
    const stepQ = compound ? 1.5 : 4 / d;
    const count = compound ? n / 3 : n;
    for (let i = 0; i < count; i++) clicks.push({ t: pb.start + i * stepQ * pb.spq, accent: i === 0, played: pb.k });
  }
  return clicks;
}

export function clickPattern(time) {
  const [n, d] = time;
  const compound = d === 8 && n % 3 === 0 && n > 3;
  return { stepQ: compound ? 1.5 : 4 / d, count: compound ? n / 3 : n };
}
