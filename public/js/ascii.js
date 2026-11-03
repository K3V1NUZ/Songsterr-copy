// Converts classic ASCII tabs (e|---0---3---|) into TabDown.
// ASCII tabs have no exact rhythm, so durations are estimated from the
// horizontal spacing (snapped to a 16th-note grid, each bar filled exactly).
// Always listen through and fix the rhythm afterwards.

const LINE_RE = /^\s*([A-Ga-g][#b]?\d?)?\s*[|:](.*)$/;

export function asciiToTabDown(text, opts = {}) {
  const time = opts.time || [4, 4];
  const tempo = opts.tempo || 100;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  // 1. find systems (groups of consecutive tab lines)
  const systems = [];
  let cur = [];
  for (const raw of lines) {
    const m = LINE_RE.exec(raw);
    const isTab = m && (m[2].match(/-/g) || []).length >= 4;
    if (isTab) cur.push({ label: m[1] || '', body: '|' + m[2] });
    else { if (cur.length >= 4) systems.push(cur); cur = []; }
  }
  if (cur.length >= 4) systems.push(cur);
  if (!systems.length) return { text: '', error: 'No ASCII tab lines found (expected lines like  e|---0---|)' };

  const strings = systems[0].length;
  const labels = systems[0].map((l) => l.label);
  const barQ = (time[0] * 4) / time[1];
  const barSix = Math.round(barQ * 4);
  const out = [];
  let barCount = 0;
  for (const sys of systems) {
    if (sys.length !== strings) continue;
    const width = Math.max(...sys.map((l) => l.body.length));
    const rows = sys.map((l) => l.body.padEnd(width, '-'));
    // split into bars on columns where (almost) every line has '|'
    const barCols = [];
    for (let c = 0; c < width; c++) {
      const n = rows.filter((r) => r[c] === '|').length;
      if (n >= strings - 1) barCols.push(c);
    }
    if (barCols[barCols.length - 1] !== width - 1) barCols.push(width);
    for (let bi = 0; bi + 1 < barCols.length; bi++) {
      const c0 = barCols[bi] + 1, c1 = barCols[bi + 1];
      if (c1 - c0 < 2) continue;
      const beats = []; // {col, notes:[]}
      for (let c = c0; c < c1; c++) {
        const notes = [];
        for (let s = 0; s < strings; s++) {
          const r = rows[s];
          const ch = r[c];
          const prev = r[c - 1];
          if (/\d/.test(ch) && !/\d/.test(prev)) {
            let num = ch, k = c + 1;
            if (/\d/.test(r[k]) && +(ch + r[k]) <= 30) { num += r[k]; k++; }
            let mods = '';
            const tch = r[k];
            if (tch === 'h' || tch === 'p') mods += tch;
            else if (tch === '/' || tch === '\\' || tch === 's') mods += '/';
            else if (tch === 'b') mods += 'b';
            else if (tch === '~') mods += '~';
            notes.push(`${s + 1}:${num}${mods}`);
          } else if ((ch === 'x' || ch === 'X') && !/[a-z]/i.test(prev || '')) notes.push(`${s + 1}:x`);
        }
        if (notes.length) beats.push({ col: c, notes });
      }
      const pos = gridPositions(beats.map((b) => b.col), c0, c1, barSix);
      const tokens = [];
      let curDur = null;
      const emit = (six, what) => {
        for (const [d, tok] of decompose(six)) {
          if (tok !== curDur) { tokens.push(tok); curDur = tok; }
          tokens.push(d === 0 ? what : 'r');
        }
      };
      if (!beats.length) emit(barSix, 'r');
      if (beats.length && pos[0] > 0) emit(pos[0], 'r');
      beats.forEach((b, i) => {
        const end = i + 1 < beats.length ? pos[i + 1] : barSix;
        const six = Math.max(1, end - pos[i]);
        const what = b.notes.length === 1 ? b.notes[0] : `[${b.notes.join(' ')}]`;
        emit(six, what);
      });
      out.push(tokens.join(' ') + ' |');
      barCount++;
    }
  }
  const tuning = guessTuning(labels, strings);
  const head = [
    `title: ${opts.title || 'Imported tab'}`,
    `artist: ${opts.artist || ''}`,
    `tempo: ${tempo}`,
    `time: ${time[0]}/${time[1]}`,
    '',
    `track: ${opts.track || (strings === 4 ? 'Bass' : 'Guitar')}`,
    `instrument: ${strings <= 5 && strings !== 6 ? 'bass' : 'guitar'}`,
    `tuning: ${tuning}`,
    '# Rhythm below was GUESSED from the ASCII spacing — check it by ear.',
  ];
  return { text: head.join('\n') + '\n' + out.join('\n') + '\n', bars: barCount };
}

// Estimate 16th-grid positions from column spacing: the most common gap
// between notes is taken as one rhythmic "slot", and the number of slots in
// the bar is snapped to a value that divides the bar evenly.
function gridPositions(cols, c0, c1, barSix) {
  if (!cols.length) return [];
  const gaps = cols.slice(1).map((c, i) => c - cols[i]);
  const counts = {};
  gaps.forEach((g) => (counts[g] = (counts[g] || 0) + 1));
  let g = +Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a - b)[0] || Math.max(1, (c1 - c0) / (cols.length + 1));
  const lead = cols[0] - c0;
  const start = lead >= 1.5 * g ? c0 + 1 : cols[0]; // big lead gap = the bar starts with a rest
  const slots = (c1 - start) / g;
  const cands = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32].filter((n) => n <= barSix && barSix % n === 0);
  const N = cands.reduce((best, n) => (Math.abs(n - slots) < Math.abs(best - slots) ? n : best), cands[0]);
  const unit = barSix / N;
  const pos = cols.map((c) => Math.round(((c - start) / g) * unit));
  for (let i = 0; i < pos.length; i++) {
    if (pos[i] < 0) pos[i] = 0;
    if (i && pos[i] <= pos[i - 1]) pos[i] = pos[i - 1] + 1;
  }
  // squeeze if we overflowed the bar
  const over = pos[pos.length - 1] - (barSix - 1);
  if (over > 0) for (let i = pos.length - 1; i >= 0; i--) pos[i] = Math.min(pos[i], barSix - (pos.length - i));
  return pos;
}

// 16th-count -> list of [index, token]; first piece carries the note, the rest become rests
function decompose(six) {
  const table = [[16, 'w'], [12, 'h.'], [8, 'h'], [6, 'q.'], [4, 'q'], [3, 'e.'], [2, 'e'], [1, 's']];
  const parts = [];
  let left = six;
  while (left > 0) {
    const [v, tok] = table.find(([v]) => v <= left);
    parts.push([parts.length, tok]);
    left -= v;
  }
  return parts;
}

function guessTuning(labels, strings) {
  if (strings === 4) return 'bass';
  if (strings === 7) return '7-string';
  const l = labels.map((x) => x.replace(/\d/g, '').toLowerCase()).join('');
  if (l === 'ebgdad') return 'drop-d';
  return 'standard';
}
