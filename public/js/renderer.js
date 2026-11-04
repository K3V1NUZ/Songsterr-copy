// Renders one track of a parsed song as tablature rows (SVG), handles the
// moving cursor, bar highlighting, click-to-seek and drag-to-loop.
import { DRUMS, DRUM_ORDER, midiToName } from './music.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};
const BEAMS = { w: 0, h: 0, q: 0, e: 1, s: 2, t: 3 };

export class TabView {
  constructor(container, scroller) {
    this.root = container;
    this.scroller = scroller || container;
    this.rowsEl = document.createElement('div');
    this.rowsEl.className = 'rows';
    this.cursor = document.createElement('div');
    this.cursor.className = 'cursor';
    this.root.append(this.rowsEl, this.cursor);
    this.zoom = 1;
    this.follow = true;
    this.handlers = {};
    this._curRow = -1;
    this._curBeatEls = [];
    this._resizeObs = new ResizeObserver(() => {
      const w = this.root.clientWidth;
      if (this.song && Math.abs(w - this._lastWidth) > 4) this.render(this.song, this.trackIndex);
    });
    this._resizeObs.observe(this.root);
  }
  on(ev, fn) { this.handlers[ev] = fn; }

  render(song, trackIndex) {
    this.song = song; this.trackIndex = trackIndex;
    this.track = song.tracks[trackIndex];
    this._lastWidth = this.root.clientWidth;
    this.rowsEl.innerHTML = '';
    this._curRow = -1; this._curBar = -1;
    const isDrums = this.track.instrument === 'drums';
    // vertical lines = strings, or used drum pieces
    if (isDrums) {
      const used = new Set();
      this.track.bars.forEach((b) => b.beats.forEach((bt) => bt.notes.forEach((n) => used.add(n.drum))));
      this.lines = DRUM_ORDER.filter((d) => used.has(d));
      if (!this.lines.length) this.lines = ['hihat', 'snare', 'kick'];
    } else this.lines = this.track.tuning.map((m) => midiToName(m, false)).reverse(); // high string first
    const Z = this.zoom;
    const L = {
      gap: 12 * Z, top: 46 * Z, rhythm: 32 * Z, bottom: 8 * Z, left: 30, leftRest: 6,
    };
    L.tabH = (this.lines.length - 1) * L.gap;
    L.rowH = L.top + L.tabH + L.rhythm + L.bottom;
    this.L = L;
    const width = Math.max(320, this.root.clientWidth - 24);

    // measure bars
    const bars = this.track.bars.map((bar, i) => {
      const mb = song.masterBars[i];
      const prev = song.masterBars[i - 1];
      const showTime = !prev || prev.time[0] !== mb.time[0] || prev.time[1] !== mb.time[1];
      const lead = (showTime ? 20 : 0) * Z + (mb.repeatStart ? 10 : 0) + 8 * Z;
      const beatW = bar.beats.map((b) => (b.fullRest ? 44 : 12 + 19 * Math.pow(b.q, 0.55)) * Z);
      const w = lead + beatW.reduce((a, b) => a + b, 0) + 4 * Z + (mb.repeatEnd ? 10 : 0);
      return { i, bar, mb, showTime, lead, beatW, w };
    });
    // pack rows
    const rows = [];
    let cur = [], cw = 0;
    // tuning labels are shown on the first row only; later rows start further left
    const leftOf = (ri) => (ri === 0 ? L.left : L.leftRest);
    for (const b of bars) {
      if (cur.length && cw + b.w > width - leftOf(rows.length)) { rows.push(cur); cur = []; cw = 0; }
      cur.push(b); cw += b.w;
    }
    if (cur.length) rows.push(cur);

    this.barLayout = [];
    this.rows = [];
    rows.forEach((rowBars, ri) => {
      const total = rowBars.reduce((a, b) => a + b.w, 0);
      const isLast = ri === rows.length - 1;
      const left = leftOf(ri);
      const avail = width - left;
      const scale = isLast ? Math.min(1.15, avail / total) : avail / total;
      const svg = el('svg', { width, height: L.rowH, class: 'row' });
      const rowDiv = document.createElement('div');
      rowDiv.className = 'row-wrap';
      rowDiv.appendChild(svg);
      this.rowsEl.appendChild(rowDiv);
      const gBg = el('g', {}, svg), gLines = el('g', { class: 'lines' }, svg), gNotes = el('g', {}, svg);
      const y0 = L.top;
      const rowEnd = left + total * scale;
      // string lines (+ tuning / drum labels on the first row)
      this.lines.forEach((name, li) => {
        const y = y0 + li * L.gap;
        el('line', { x1: left, x2: rowEnd, y1: y, y2: y, class: 'string' }, gLines);
        if (ri === 0) {
          const t = el('text', { x: left - 8, y: y + 3.5, class: 'tuning', 'text-anchor': 'end' }, gLines);
          t.textContent = isDrums ? DRUMS[name].label : name;
        }
      });
      let x = left;
      for (const b of rowBars) {
        const bx = x, bw = b.w * scale;
        const layout = { row: ri, x: bx, w: bw, beats: [], beatEls: [], i: b.i };
        this.barLayout[b.i] = layout;
        const bg = el('rect', { x: bx, y: 4, width: bw, height: L.rowH - 8, class: 'bar-bg', 'data-bar': b.i }, gBg);
        layout.bg = bg;
        // bar lines
        const barLine = (xx, cls = 'barline') => el('line', { x1: xx, x2: xx, y1: y0, y2: y0 + L.tabH, class: cls }, gLines);
        barLine(bx);
        if (b.mb.repeatStart) {
          el('rect', { x: bx, y: y0, width: 3, height: L.tabH, class: 'thick' }, gLines);
          barLine(bx + 6);
          this._repeatDots(gLines, bx + 10, y0, L.tabH);
        }
        if (b.mb.repeatEnd) {
          el('rect', { x: bx + bw - 3, y: y0, width: 3, height: L.tabH, class: 'thick' }, gLines);
          barLine(bx + bw - 6);
          this._repeatDots(gLines, bx + bw - 10, y0, L.tabH);
          if ((b.mb.repeatTimes || 2) !== 2) this._text(gNotes, bx + bw - 4, y0 - 4, `x${b.mb.repeatTimes}`, 'small', 'end');
        }
        if (b === rowBars[rowBars.length - 1]) barLine(bx + bw);
        // header annotations
        this._text(gNotes, bx + 3, y0 - 4, String(b.i + 1), 'barnum');
        let annY = 13 * this.zoom;
        let annX = bx + 2;
        if (b.mb.section) {
          const t = this._text(gNotes, annX + 4, annY, b.mb.section, 'section');
          const len = b.mb.section.length * 7.2 + 10;
          const r = el('rect', { x: annX, y: annY - 11, width: len, height: 15, rx: 3, class: 'section-bg' });
          gNotes.insertBefore(r, t);
          annX += len + 6;
        }
        const prevMb = this.song.masterBars[b.i - 1];
        if (!prevMb || prevMb.tempo !== b.mb.tempo) {
          el('ellipse', { cx: annX + 3.5, cy: annY - 2.5, rx: 3.6, ry: 2.6, transform: `rotate(-20 ${annX + 3.5} ${annY - 2.5})`, class: 'beam' }, gNotes);
          el('line', { x1: annX + 6.8, x2: annX + 6.8, y1: annY - 3, y2: annY - 14, class: 'stem' }, gNotes);
          this._text(gNotes, annX + 12, annY, `= ${b.mb.tempo}`, 'tempo'); annX += 62;
        }
        if (b.mb.ending) this._ending(gNotes, bx, bw, y0, b.mb.ending);
        if (b.mb.text) this._text(gNotes, annX, annY, b.mb.text, 'bartext');
        if (b.showTime) {
          const tx = bx + (b.mb.repeatStart ? 22 : 12) * this.zoom;
          this._text(gNotes, tx, y0 + L.tabH / 2 - 2, String(b.mb.time[0]), 'timesig', 'middle');
          this._text(gNotes, tx, y0 + L.tabH / 2 + 16 * this.zoom, String(b.mb.time[1]), 'timesig', 'middle');
        }
        // beats
        let bxx = bx + b.lead * scale;
        b.bar.beats.forEach((beat, bi) => {
          const w = b.beatW[bi] * scale;
          const cx = b.bar.beats.length === 1 && beat.fullRest ? bx + bw / 2 : bxx + 9 * this.zoom;
          layout.beats.push({ x: cx, pos: beat.pos, q: beat.q });
          const g = el('g', { class: 'beat' }, gNotes);
          layout.beatEls.push(g);
          this._drawBeat(g, beat, cx, y0, isDrums, b, bi);
          bxx += w;
        });
        layout.endX = bx + bw;
        layout.lengthQ = b.mb.lengthQ;
        this._drawRhythm(gNotes, b, layout, y0 + L.tabH);
        this._drawTechniqueLinks(gNotes, b, layout, y0);
        x += bw;
      }
      this.rows.push({ el: rowDiv, svg });
      svg.addEventListener('pointerdown', (e) => this._pointer(e, 'down'));
      svg.addEventListener('pointermove', (e) => this._pointer(e, 'move'));
      svg.addEventListener('pointerup', (e) => this._pointer(e, 'up'));
    });
    if (this._loopRange) this.setLoopBars(...this._loopRange);
  }

  _text(g, x, y, str, cls, anchor = 'start') {
    const t = el('text', { x, y, class: cls, 'text-anchor': anchor }, g);
    t.textContent = str;
    return t;
  }
  _repeatDots(g, x, y0, h) {
    el('circle', { cx: x, cy: y0 + h * 0.38, r: 2.2, class: 'dot' }, g);
    el('circle', { cx: x, cy: y0 + h * 0.62, r: 2.2, class: 'dot' }, g);
  }
  _ending(g, bx, bw, y0, list) {
    const y = y0 - 34 * this.zoom;
    el('path', { d: `M${bx + 2},${y + 10} V${y} H${bx + bw - 4}`, class: 'ending' }, g);
    this._text(g, bx + 18, y + 10, list.join('.') + '.', 'small');
  }
  _lineY(note, y0) {
    if (note.drum) return y0 + Math.max(0, this.lines.indexOf(note.drum)) * this.L.gap;
    return y0 + (note.string - 1) * this.L.gap;
  }

  _drawBeat(g, beat, cx, y0, isDrums, b, bi) {
    const L = this.L;
    for (const n of beat.notes) {
      const y = this._lineY(n, y0);
      if (isDrums) {
        const cym = ['hihat', 'ohat', 'crash', 'ride', 'pedal'].includes(n.drum);
        if (cym) {
          const s = 4;
          el('path', { d: `M${cx - s},${y - s}L${cx + s},${y + s}M${cx - s},${y + s}L${cx + s},${y - s}`, class: 'drumx' + (n.ghost ? ' ghost' : '') }, g);
          if (n.drum === 'ohat') el('circle', { cx, cy: y - 9, r: 3, class: 'ohat' }, g);
        } else el('circle', { cx, cy: y, r: 4.5, class: 'drumo' + (n.ghost ? ' ghost' : '') }, g);
        if (n.accent) this._text(g, cx, y0 - 12, '>', 'tech', 'middle');
        continue;
      }
      let label = n.dead ? 'x' : String(n.fret);
      if (n.harmonic) label = `<${n.fret}>`;
      if (n.ghost) label = `(${n.fret})`;
      if (n.tie) label = `(${n.fret})`;
      const w = label.length * 7 * this.zoom + 3;
      el('rect', { x: cx - w / 2, y: y - 6.5 * this.zoom, width: w, height: 13 * this.zoom, class: 'note-bg' }, g);
      const t = this._text(g, cx, y + 4.2 * this.zoom, label, 'fret' + (n.tie ? ' tie' : ''), 'middle');
      if (n.bend) {
        const amt = n.bend === 2 ? 'full' : n.bend === 1 ? '½' : n.bend === 4 ? '2' : String(n.bend / 2);
        el('path', { d: `M${cx + w / 2},${y} Q${cx + 14},${y} ${cx + 14},${y0 - 12}`, class: 'bend' }, g);
        el('path', { d: `M${cx + 10},${y0 - 8} L${cx + 14},${y0 - 14} L${cx + 18},${y0 - 8}Z`, class: 'arrow' }, g);
        this._text(g, cx + 14, y0 - 17, amt, 'tech', 'middle');
      }
      if (n.vibrato) this._text(g, cx - 4, y0 - 12 - (n.bend ? 14 : 0), '∿∿', 'tech');
      if (n.palmMute) this._text(g, cx, y0 - 12, 'P.M.', 'tech pm', 'middle');
      if (n.accent) this._text(g, cx, y0 - 12, '>', 'tech', 'middle');
      if (n.letRing) this._text(g, cx, y0 - 12, 'l.r.', 'tech', 'middle');
      t.dataset.string = n.string;
    }
  }

  // hammer-on / pull-off arcs and slides within the bar (and to the next bar on the same row)
  _drawTechniqueLinks(g, b, layout, y0) {
    if (this.track.instrument === 'drums') return;
    b.bar.beats.forEach((beat, bi) => {
      for (const n of beat.notes) {
        if (!(n.hammer || n.pull || n.slide)) continue;
        let x2 = null, n2 = null;
        for (let j = bi + 1; j < b.bar.beats.length && !n2; j++) {
          n2 = b.bar.beats[j].notes.find((m) => m.string === n.string);
          if (n2) x2 = layout.beats[j].x;
        }
        if (!n2) {
          const nl = this.barLayout[b.i + 1];
          const nb = this.track.bars[b.i + 1];
          if (nl && nl.row === layout.row && nb) {
            for (let j = 0; j < nb.beats.length && !n2; j++) {
              n2 = nb.beats[j].notes.find((m) => m.string === n.string);
              if (n2) x2 = nl.beats[j]?.x;
            }
          }
        }
        const x1 = layout.beats[bi].x;
        const y = this._lineY(n, y0);
        if (x2 == null) x2 = x1 + 22;
        if (n.slide) {
          const up = !n2 || (n2.fret ?? 0) >= (n.fret ?? 0);
          el('line', { x1: x1 + 7, x2: x2 - 7, y1: y + (up ? 4 : -4), y2: y + (up ? -4 : 4), class: 'slide' }, g);
        } else {
          const mid = (x1 + x2) / 2;
          el('path', { d: `M${x1 + 3},${y - 8} Q${mid},${y - 17} ${x2 - 3},${y - 8}`, class: 'arc' }, g);
          this._text(g, mid, y - 15, n.hammer ? 'H' : 'P', 'tech small', 'middle');
        }
      }
    });
  }

  _drawRhythm(g, b, layout, yTabBottom) {
    const Z = this.zoom;
    const yA = yTabBottom + 8 * Z, yB = yTabBottom + 28 * Z;
    const beats = b.bar.beats;
    const [num, den] = b.mb.time;
    const groupQ = den === 8 && num % 3 === 0 ? 1.5 : 1;
    // beam groups
    const groups = [];
    let curG = null;
    beats.forEach((bt, i) => {
      const beamable = !bt.rest && BEAMS[bt.dur.base] > 0;
      const gi = Math.floor((bt.pos + 1e-6) / groupQ);
      if (beamable && curG && curG.gi === gi) curG.items.push(i);
      else if (beamable) { curG = { gi, items: [i] }; groups.push(curG); }
      else curG = null;
    });
    const inGroup = new Map();
    groups.forEach((gr) => gr.items.forEach((i) => inGroup.set(i, gr)));
    beats.forEach((bt, i) => {
      const x = layout.beats[i].x;
      if (bt.rest) { if (!bt.fullRest || beats.length > 1) this._rest(g, x, (yA + yB) / 2, bt.dur.base); else this._rest(g, x, (yA + yB) / 2, 'w'); return; }
      const base = bt.dur.base;
      if (base === 'w') { /* no stem */ }
      else el('line', { x1: x, x2: x, y1: base === 'h' ? yA + 10 * Z : yA, y2: yB, class: 'stem' }, g);
      if (bt.dur.dots) for (let d = 0; d < bt.dur.dots; d++) el('circle', { cx: x + 4 + d * 4, cy: yB - 3, r: 1.6, class: 'dot' }, g);
      const gr = inGroup.get(i);
      const nb = BEAMS[base];
      if (nb && (!gr || gr.items.length === 1)) {
        for (let k = 0; k < nb; k++) el('path', { d: `M${x},${yB - k * 5} q6,-2 7,-9`, class: 'flag' }, g);
      }
    });
    for (const gr of groups) {
      if (gr.items.length < 2) continue;
      const xs = gr.items.map((i) => layout.beats[i].x);
      el('rect', { x: xs[0], y: yB - 2.5, width: xs[xs.length - 1] - xs[0], height: 3.2, class: 'beam' }, g);
      // secondary beams
      for (let level = 2; level <= 3; level++) {
        for (let a = 0; a < gr.items.length; a++) {
          if (BEAMS[beats[gr.items[a]].dur.base] < level) continue;
          let z = a;
          while (z + 1 < gr.items.length && BEAMS[beats[gr.items[z + 1]].dur.base] >= level) z++;
          const yy = yB - 2.5 - (level - 1) * 5;
          if (z > a) el('rect', { x: xs[a], y: yy, width: xs[z] - xs[a], height: 3.2, class: 'beam' }, g);
          else { const dir = a === gr.items.length - 1 ? -6 : 6; el('rect', { x: Math.min(xs[a], xs[a] + dir), y: yy, width: 6, height: 3.2, class: 'beam' }, g); }
          a = z;
        }
      }
      const tup = beats[gr.items[0]].dur.tuplet;
      if (tup) this._text(g, (xs[0] + xs[xs.length - 1]) / 2, yB + 11, String(tup), 'small', 'middle');
    }
    // lone tuplets
    beats.forEach((bt, i) => { if (bt.dur.tuplet && !inGroup.get(i)?.items?.[1]) this._text(g, layout.beats[i].x, yB + 11, String(bt.dur.tuplet), 'small', 'middle'); });
  }
  _rest(g, x, y, base) {
    if (base === 'w') el('rect', { x: x - 5, y: y - 6, width: 10, height: 4, class: 'rest' }, g);
    else if (base === 'h') el('rect', { x: x - 5, y: y - 2, width: 10, height: 4, class: 'rest' }, g);
    else if (base === 'q') el('path', { d: `M${x - 2},${y - 9} l4,5 l-4,4 l4,5 q-5,-2 -3,3`, class: 'rest-line' }, g);
    else {
      const n = BEAMS[base];
      let d = '';
      for (let k = 0; k < n; k++) d += `M${x + 3 - k * 1.5},${y - 6 + k * 5} l-3,9 M${x - 3 - k * 1.5},${y - 5 + k * 5} q3,2 6,-1 `;
      el('path', { d, class: 'rest-line' }, g);
      for (let k = 0; k < n; k++) el('circle', { cx: x - 3 - k * 1.5, cy: y - 6 + k * 5, r: 1.7, class: 'dot' }, g);
    }
  }

  // ---- cursor & highlighting -------------------------------------------
  // barIndex (written bar), q = position inside bar in quarters
  setCursor(barIndex, q, playing) {
    const lay = this.barLayout?.[barIndex];
    if (!lay) { this.cursor.style.display = 'none'; return; }
    const beats = lay.beats;
    let x = lay.endX, bi = beats.length - 1;
    for (let i = 0; i < beats.length; i++) {
      const nextPos = i + 1 < beats.length ? beats[i + 1].pos : lay.lengthQ;
      const nextX = i + 1 < beats.length ? beats[i + 1].x : lay.endX - 4;
      if (q < nextPos || i === beats.length - 1) {
        const f = Math.max(0, Math.min(1, (q - beats[i].pos) / Math.max(1e-6, nextPos - beats[i].pos)));
        x = beats[i].x + (nextX - beats[i].x) * f;
        bi = i; break;
      }
    }
    const row = this.rows[lay.row];
    const top = row.el.offsetTop;
    this.cursor.style.display = 'block';
    this.cursor.style.height = this.L.rowH - 8 + 'px';
    this.cursor.style.transform = `translate(${x - 1 + row.el.offsetLeft}px, ${top + 4}px)`;
    if (this._curBar !== barIndex) {
      this.barLayout[this._curBar]?.bg.classList.remove('current');
      lay.bg.classList.add('current');
      this._curBar = barIndex;
    }
    const beatEl = lay.beatEls[bi];
    if (this._curBeatEl !== beatEl) {
      this._curBeatEl?.classList.remove('playing');
      if (playing) beatEl?.classList.add('playing');
      this._curBeatEl = beatEl;
    }
    if (!playing) this._curBeatEl?.classList.remove('playing');
    if (lay.row !== this._curRow) {
      this._curRow = lay.row;
      if (this.follow && playing) this.scrollToRow(lay.row);
    }
  }
  scrollToRow(ri, smooth = true) {
    const row = this.rows[ri];
    if (!row) return;
    const sc = this.scroller;
    const target = this.root.offsetTop + row.el.offsetTop - Math.min(sc.clientHeight * 0.18, 90);
    sc.scrollTo({ top: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
  }
  ensureVisible(barIndex) {
    const lay = this.barLayout?.[barIndex];
    if (!lay) return;
    const r = this.rows[lay.row].el;
    const sc = this.scroller, top = this.root.offsetTop + r.offsetTop;
    if (top < sc.scrollTop || top + r.offsetHeight > sc.scrollTop + sc.clientHeight) this.scrollToRow(lay.row);
  }

  setLoopBars(a, b) {
    this._loopRange = a == null ? null : [Math.min(a, b), Math.max(a, b)];
    (this.barLayout || []).forEach((lay, i) => {
      if (!lay) return;
      const on = this._loopRange && i >= this._loopRange[0] && i <= this._loopRange[1];
      lay.bg.classList.toggle('loop', !!on);
    });
  }

  // ---- input -------------------------------------------------------------
  _hit(e) {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ri = this.rows.findIndex((r) => r.svg === svg);
    const lay = this.barLayout.find((l) => l && l.row === ri && x >= l.x && x < l.x + l.w);
    if (!lay) return null;
    // nearest beat at or before x
    let bi = 0;
    for (let i = 0; i < lay.beats.length; i++) if (lay.beats[i].x - 8 <= x) bi = i;
    return { bar: lay.i, q: lay.beats[bi]?.pos ?? 0 };
  }
  _pointer(e, type) {
    const h = this._hit(e);
    if (type === 'down') { if (!h) return; this._drag = { start: h, moved: false }; e.currentTarget.setPointerCapture?.(e.pointerId); return; }
    if (!this._drag) return;
    if (type === 'move') {
      // pointer capture keeps events on the starting svg; resolve real target
      const tgt = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('svg.row');
      if (tgt && tgt !== e.currentTarget) return this._dragOver(tgt, e);
      if (h && h.bar !== this._drag.start.bar) { this._drag.moved = true; this._drag.end = h; this.setLoopBars(this._drag.start.bar, h.bar); }
      return;
    }
    if (type === 'up') {
      const d = this._drag; this._drag = null;
      if (d.moved && d.end) this.handlers.loop?.(Math.min(d.start.bar, d.end.bar), Math.max(d.start.bar, d.end.bar));
      else if (h) this.handlers.seek?.(h.bar, h.q, e.shiftKey);
    }
  }
  _dragOver(svg, e) {
    const fake = { currentTarget: svg, clientX: e.clientX };
    const h = this._hit(fake);
    if (h && h.bar !== this._drag.start.bar) { this._drag.moved = true; this._drag.end = h; this.setLoopBars(this._drag.start.bar, h.bar); }
  }
}
