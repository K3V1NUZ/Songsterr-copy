// Import model -> standard MusicXML 4.0 (partwise) with a TAB staff per part.
// Opens in MuseScore, Guitar Pro, Finale, Sibelius, Dorico… and back in Fretline.
import { DRUMS, durationQuarters } from '../music.js';
import { gmDrum } from './model.js';

const TYPE = { w: 'whole', h: 'half', q: 'quarter', e: 'eighth', s: '16th', t: '32nd' };
const STEPS = [['C', 0], ['C', 1], ['D', 0], ['D', 1], ['E', 0], ['F', 0], ['F', 1], ['G', 0], ['G', 1], ['A', 0], ['A', 1], ['B', 0]];
const PROGRAM = { acoustic: 26, guitar: 26, electric: 28, distortion: 31, bass: 34, ukulele: 25, banjo: 106, keys: 1 }; // 1-based
const DRUM_DISPLAY = { kick: 'F4', snare: 'C5', sidestick: 'C5', hihat: 'G5', ohat: 'G5', pedal: 'D4', crash: 'A5', ride: 'F5', tom1: 'E5', tom2: 'D5', tom3: 'A4' };
const CYMBALS = new Set(['hihat', 'ohat', 'pedal', 'crash', 'ride']);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pitchXml = (midi) => {
  const [step, alter] = STEPS[((midi % 12) + 12) % 12];
  return `<pitch><step>${step}</step>${alter ? '<alter>1</alter>' : ''}<octave>${Math.floor(midi / 12) - 1}</octave></pitch>`;
};

export function modelToMusicXML(model) {
  const tracks = model.tracks;
  const mbs = model.masterBars;
  let divisions = 24;
  const tups = new Set();
  tracks.forEach((t) => t.bars.forEach((bar) => bar.forEach((b) => b.dur.tuplet && tups.add(b.dur.tuplet))));
  if (tups.has(5)) divisions *= 5;
  if (tups.has(7)) divisions *= 7;
  const D = (q) => Math.round(q * divisions);
  const out = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    `  <work><work-title>${esc(model.meta.title || 'Untitled')}</work-title></work>`,
    `  <identification>${model.meta.artist ? `<creator type="composer">${esc(model.meta.artist)}</creator>` : ''}<encoding><software>Fretline</software></encoding></identification>`,
    '  <part-list>'];
  tracks.forEach((t, i) => {
    const id = `P${i + 1}`;
    const drums = t.drums || t.instrument === 'drums';
    out.push(`    <score-part id="${id}"><part-name>${esc(t.name)}</part-name>`);
    if (drums) {
      for (const [name, d] of Object.entries(DRUMS)) out.push(`      <score-instrument id="${id}-${name}"><instrument-name>${name}</instrument-name></score-instrument>`);
      for (const [name, d] of Object.entries(DRUMS)) out.push(`      <midi-instrument id="${id}-${name}"><midi-channel>10</midi-channel><midi-unpitched>${d.midi + 1}</midi-unpitched></midi-instrument>`);
    } else {
      out.push(`      <score-instrument id="${id}-I1"><instrument-name>${esc(t.instrument || 'guitar')}</instrument-name></score-instrument>`);
      out.push(`      <midi-instrument id="${id}-I1"><midi-channel>${(i % 9) + 1}</midi-channel><midi-program>${PROGRAM[t.instrument] || 26}</midi-program></midi-instrument>`);
    }
    out.push('    </score-part>');
  });
  out.push('  </part-list>');

  tracks.forEach((t, ti) => {
    const id = `P${ti + 1}`;
    const drums = t.drums || t.instrument === 'drums';
    const tuning = t.tuning || [];
    const N = tuning.length;
    // link notes: ties, hammer/pull and slide targets on the same string
    const flat = [];
    t.bars.forEach((bar) => bar.forEach((b) => !b.rest && flat.push(b)));
    const lastOn = {};
    const meta = new Map();
    const m = (n) => { if (!meta.has(n)) meta.set(n, {}); return meta.get(n); };
    flat.forEach((b, k) => {
      for (const n of b.notes) {
        if (drums || n.string == null) continue;
        const prev = lastOn[n.string];
        if (n.tie && prev) { m(prev).tieStart = true; n.fret = prev.fret; }
        if (prev && (prev.legato || prev.slide) && !n.tie) {
          const kind = prev.slide ? 'slide' : (n.fret ?? 0) >= (prev.fret ?? 0) ? 'hammer-on' : 'pull-off';
          m(prev).startKind = kind; m(n).stopKind = kind;
        }
        lastOn[n.string] = n;
      }
    });
    out.push(`  <part id="${id}">`);
    let prevTime = null, endingOpen = false;
    mbs.forEach((mb, bi) => {
      const beats = t.bars[bi] || [];
      out.push(`    <measure number="${bi + 1}"${bi === 0 && mb.pickup ? ' implicit="yes"' : ''}>`);
      const timeChanged = !prevTime || prevTime[0] !== mb.time[0] || prevTime[1] !== mb.time[1];
      // left barline: repeat start / ending start
      const endStart = mb.ending && (bi === 0 || JSON.stringify(mbs[bi - 1].ending) !== JSON.stringify(mb.ending));
      if (mb.repeatStart || endStart) {
        out.push(`      <barline location="left">${endStart ? `<ending number="${mb.ending.join(', ')}" type="start">${mb.ending.join('.')}.</ending>` : ''}${mb.repeatStart ? '<repeat direction="forward"/>' : ''}</barline>`);
        if (endStart) endingOpen = true;
      }
      if (bi === 0 || timeChanged) {
        const attrs = [];
        if (bi === 0) attrs.push(`<divisions>${divisions}</divisions><key><fifths>0</fifths></key>`);
        attrs.push(`<time><beats>${mb.time[0]}</beats><beat-type>${mb.time[1]}</beat-type></time>`);
        if (bi === 0) {
          if (drums) attrs.push('<clef><sign>percussion</sign></clef>');
          else {
            attrs.push(`<clef><sign>TAB</sign><line>5</line></clef>`);
            const lines = tuning.map((p, k) => {
              const [step, alter] = STEPS[((p % 12) + 12) % 12];
              return `<staff-tuning line="${k + 1}"><tuning-step>${step}</tuning-step>${alter ? '<tuning-alter>1</tuning-alter>' : ''}<tuning-octave>${Math.floor(p / 12) - 1}</tuning-octave></staff-tuning>`;
            }).join('');
            attrs.push(`<staff-details><staff-lines>${N}</staff-lines>${lines}${t.capo ? `<capo>${t.capo}</capo>` : ''}</staff-details>`);
          }
        }
        out.push(`      <attributes>${attrs.join('')}</attributes>`);
      }
      prevTime = mb.time;
      if (ti === 0) {
        if (mb.section) out.push(`      <direction placement="above"><direction-type><rehearsal>${esc(mb.section)}</rehearsal></direction-type></direction>`);
        const prevTempo = bi > 0 ? mbs[bi - 1].tempo : null;
        if (mb.tempo && mb.tempo !== prevTempo) {
          out.push(`      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${+mb.tempo.toFixed(2)}</per-minute></metronome></direction-type><sound tempo="${+mb.tempo.toFixed(2)}"/></direction>`);
        }
      }
      const barQ = (mb.time[0] * 4) / mb.time[1];
      if (!beats.length || beats.every((b) => b.rest)) {
        const sum = beats.reduce((a, b) => a + durationQuarters(b.dur.base, b.dur.dots, b.dur.tuplet), 0);
        out.push(`      <note><rest measure="yes"/><duration>${D(beats.length ? sum : barQ)}</duration><voice>1</voice></note>`);
      } else {
        for (const b of beats) {
          const q = durationQuarters(b.dur.base, b.dur.dots, b.dur.tuplet);
          const common = `<duration>${D(q)}</duration>`;
          const tail = `<voice>1</voice><type>${TYPE[b.dur.base]}</type>${'<dot/>'.repeat(b.dur.dots || 0)}${b.dur.tuplet ? `<time-modification><actual-notes>${b.dur.tuplet}</actual-notes><normal-notes>${b.dur.tuplet === 3 ? 2 : 4}</normal-notes></time-modification>` : ''}`;
          if (b.rest || !b.notes.length) { out.push(`      <note><rest/>${common}${tail}</note>`); continue; }
          b.notes.forEach((n, k) => {
            const chord = k > 0 ? '<chord/>' : '';
            if (drums) {
              const nm = n.drum || gmDrum(n.midi) || 'snare';
              const disp = DRUM_DISPLAY[nm];
              const head = CYMBALS.has(nm) ? '<notehead>x</notehead>' : n.ghost ? '<notehead parentheses="yes">normal</notehead>' : '';
              const art = n.accent ? '<notations><articulations><accent/></articulations></notations>' : '';
              out.push(`      <note>${chord}<unpitched><display-step>${disp[0]}</display-step><display-octave>${disp[1]}</display-octave></unpitched>${common}<instrument id="${id}-${nm}"/>${tail}${head}${art}</note>`);
              return;
            }
            const info = meta.get(n) || {};
            const fret = n.fret ?? 0;
            const midi = n.string ? tuning[N - n.string] + (t.capo || 0) + fret : n.midi;
            const ties = (n.tie ? '<tie type="stop"/>' : '') + (info.tieStart ? '<tie type="start"/>' : '');
            const tied = (n.tie ? '<tied type="stop"/>' : '') + (info.tieStart ? '<tied type="start"/>' : '');
            const head = n.dead ? '<notehead>x</notehead>' : n.ghost ? '<notehead parentheses="yes">normal</notehead>' : '';
            const tech = [];
            if (info.stopKind && info.stopKind !== 'slide') tech.push(`<${info.stopKind} type="stop"/>`);
            if (info.startKind && info.startKind !== 'slide') tech.push(`<${info.startKind} type="start">${info.startKind === 'hammer-on' ? 'H' : 'P'}</${info.startKind}>`);
            if (n.bend) tech.push(`<bend><bend-alter>${n.bend}</bend-alter></bend>`);
            if (n.harmonic) tech.push('<harmonic><natural/></harmonic>');
            if (n.letRing) tech.push('<other-technical>let ring</other-technical>');
            if (n.string) tech.push(`<string>${n.string}</string><fret>${fret}</fret>`);
            const nots = [tied];
            if (info.stopKind === 'slide') nots.push('<slide type="stop"/>');
            if (info.startKind === 'slide' || (n.slide && !info.startKind)) nots.push('<slide type="start" line-type="solid"/>');
            if (n.vibrato) nots.push('<ornaments><wavy-line type="start"/></ornaments>');
            if (tech.length) nots.push(`<technical>${tech.join('')}</technical>`);
            if (n.accent) nots.push('<articulations><accent/></articulations>');
            const notations = nots.join('') ? `<notations>${nots.join('')}</notations>` : '';
            const play = n.palmMute ? '<play><mute>palm</mute></play>' : '';
            out.push(`      <note>${chord}${pitchXml(midi)}${common}${ties}${tail}${head}${notations}${play}</note>`);
          });
        }
      }
      // right barline: ending stop / repeat end
      const nextSame = mb.ending && bi + 1 < mbs.length && JSON.stringify(mbs[bi + 1].ending) === JSON.stringify(mb.ending);
      const endStop = endingOpen && mb.ending && !nextSame;
      if (mb.repeatEnd || endStop) {
        const times = (mb.repeatTimes || 2) !== 2 ? ` times="${mb.repeatTimes}"` : '';
        out.push(`      <barline location="right">${mb.repeatEnd ? '<bar-style>light-heavy</bar-style>' : ''}${endStop ? `<ending number="${mb.ending.join(', ')}" type="${mb.repeatEnd ? 'stop' : 'discontinue'}"/>` : ''}${mb.repeatEnd ? `<repeat direction="backward"${times}/>` : ''}</barline>`);
        if (endStop) endingOpen = false;
      }
      out.push('    </measure>');
    });
    out.push('  </part>');
  });
  out.push('</score-partwise>');
  return out.join('\n') + '\n';
}
