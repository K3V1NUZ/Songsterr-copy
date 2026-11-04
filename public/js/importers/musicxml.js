// MusicXML importer (.musicxml / .xml, and compressed .mxl).
// Uses tablature data (<technical><string>/<fret>) when present; otherwise
// string/fret positions are worked out from the pitches (see assignFrets).
import { parseXML, decodeText } from './xml.js';
import { isZip, readZipFile } from './zip.js';
import { durFromValue, instrumentFromProgram, Warnings, restsFor } from './model.js';

const TYPE_VALUES = { whole: 1, half: 2, quarter: 4, eighth: 8, '16th': 16, '32nd': 32, '64th': 64, '128th': 128, breve: 1, long: 1 };
const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const midiName = (m) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][m % 12] + (Math.floor(m / 12) - 1);
const SECTION_RE = /^(intro|verse|chorus|pre-?chorus|bridge|solo|outro|interlude|riff|break|coda|refrain|theme|[A-H]\d?|part\s*\w+|section\s*\w+)\b/i;
// drum display position -> GM note (fallback when the file has no instrument mapping)
const DRUM_POS = { E4: 36, F4: 36, D4: 44, A4: 41, B4: 45, C5: 38, D5: 45, E5: 48, F5: 51, G5: 42, A5: 49, B5: 52 };

export async function musicXmlBytesToText(bytes) {
  if (!isZip(bytes)) return decodeText(bytes);
  // .mxl: META-INF/container.xml names the root file
  const cont = await readZipFile(bytes, 'META-INF/container.xml');
  let rootPath = null;
  if (cont.data) rootPath = parseXML(decodeText(cont.data)).find('rootfiles/rootfile')?.attr('full-path');
  const res = await readZipFile(bytes, rootPath ? rootPath : (e) => /\.(musicxml|xml)$/i.test(e.name) && !e.name.startsWith('META-INF'));
  if (!res.data) throw new Error('No MusicXML score found inside the .mxl file');
  return decodeText(res.data);
}

export function isMusicXmlText(text) { return /<score-partwise|<score-timewise/.test(text.slice(0, 4000)); }

export function parseMusicXML(text) {
  const x = parseXML(text);
  if (x.name === 'score-timewise') throw new Error('“score-timewise” MusicXML is not supported — re-export as standard (partwise) MusicXML');
  if (x.name !== 'score-partwise') throw new Error('Not a MusicXML score' + (x.errors?.length ? ` (line ${x.errors[0].line}: ${x.errors[0].msg})` : ''));
  const warn = new Warnings();
  const lineWarnings = [];
  const creators = x.find('identification')?.all('creator') || [];
  const meta = {
    title: x.t('work/work-title') || x.t('movement-title') || 'Untitled',
    artist: (creators.find((c) => /composer|artist/i.test(c.attr('type', ''))) || creators[0])?.t() || '',
    tempo: 0, time: [4, 4],
  };
  // part list
  const partInfo = {};
  for (const sp of x.child('part-list')?.all('score-part') || []) {
    const id = sp.attr('id');
    const info = { name: sp.t('part-name') || id, program: -1, channel: 0, unpitched: {} };
    for (const mi of sp.all('midi-instrument')) {
      if (mi.has('midi-program') && info.program < 0) info.program = mi.num('midi-program') - 1;
      if (mi.has('midi-channel')) info.channel = mi.num('midi-channel');
      if (mi.has('midi-unpitched')) info.unpitched[mi.attr('id')] = mi.num('midi-unpitched') - 1;
    }
    partInfo[id] = info;
  }

  const masterBars = [];
  const tracks = [];
  const parts = x.all('part');
  parts.forEach((part, pi) => {
    const info = partInfo[part.attr('id')] || { name: `Part ${pi + 1}`, program: -1, unpitched: {} };
    const measures = part.all('measure');
    // --- scan: which staff holds the tab, tuning, which voice to use ---
    let tabStaff = null, staffCount = 1;
    const tuningByStaff = {}, capoByStaff = {};
    let hasUnpitched = false, hasTechnical = false;
    const voiceCount = {};
    for (const m of measures) for (const c of m.children) {
      if (c.name === 'attributes') {
        if (c.has('staves')) staffCount = c.num('staves', 1);
        for (const cl of c.all('clef')) if (cl.t('sign') === 'TAB') tabStaff = +cl.attr('number', 1);
        for (const sd of c.all('staff-details')) {
          const st = +sd.attr('number', 1);
          const tun = sd.all('staff-tuning').sort((a, b) => +a.attr('line') - +b.attr('line'))
            .map((t) => (t.num('tuning-octave') + 1) * 12 + STEP[t.t('tuning-step')] + t.num('tuning-alter', 0));
          if (tun.length) { tuningByStaff[st] = tun; if (tabStaff == null) tabStaff = st; }
          if (sd.has('capo')) capoByStaff[st] = sd.num('capo');
        }
      } else if (c.name === 'note') {
        if (c.has('unpitched')) hasUnpitched = true;
        if (c.find('notations/technical/fret')) hasTechnical = true;
      }
    }
    const useStaff = tabStaff ?? 1;
    for (const m of measures) for (const c of m.all('note')) {
      if (+c.t('staff', '1') !== useStaff || c.has('rest') && !c.has('voice')) continue;
      const v = c.t('voice', '1');
      voiceCount[v] = (voiceCount[v] || 0) + (c.has('rest') ? 0 : 1);
    }
    const useVoice = Object.keys(voiceCount).sort((a, b) => voiceCount[b] - voiceCount[a] || a - b)[0] || '1';
    if (Object.keys(voiceCount).length > 1) warn.add(`${info.name}: has several voices; imported voice ${useVoice} only`);
    const drums = hasUnpitched || info.channel === 10;
    const tuning = drums ? [] : (tuningByStaff[useStaff] || null);
    const lowest = tuning ? Math.min(...tuning) : 40;
    let instrument = instrumentFromProgram(info.program, { strings: tuning?.length || 6, name: info.name, drums, lowest });
    if (!drums && !tuning && !hasTechnical && instrument === 'guitar' && info.program < 0 && !/gu?i?ta?r|gtr/i.test(info.name)) instrument = 'keys';
    const track = { name: info.name, instrument, tuning: tuning || [], capo: capoByStaff[useStaff] || 0, drums, bars: [], barLines: [] };
    if (!drums && !hasTechnical) warn.add(`${info.name}: no tab data in the file — string/fret positions were worked out from the pitches`);

    // --- read measures ---
    let divisions = 1, time = [4, 4], transpose = 0;
    let ending = null;
    measures.forEach((m, mi) => {
      const mb = masterBars[mi] || (masterBars[mi] = { time, line: m.line });
      track.barLines.push(m.line);
      let cursor = 0, lastStart = 0;
      const beats = [];
      let endingStopsHere = false;
      for (const c of m.children) {
        if (c.name === 'attributes') {
          if (c.has('divisions')) divisions = c.num('divisions', 1) || 1;
          const tm = c.child('time');
          if (tm && tm.has('beats')) {
            const n = parseInt(tm.t('beats'), 10), d = parseInt(tm.t('beat-type'), 10);
            if (n > 0 && d > 0) time = [n, d];
          }
          const tr = c.child('transpose');
          if (tr) transpose = tr.num('chromatic', 0) + 12 * tr.num('octave-change', 0);
        } else if (c.name === 'direction' || c.name === 'sound') {
          const snd = c.name === 'sound' ? c : c.child('sound');
          let tempo = snd ? parseFloat(snd.attr('tempo')) : NaN;
          const met = c.find('direction-type/metronome');
          if (!isFinite(tempo) && met && met.has('per-minute')) {
            const unit = { half: 2, quarter: 1, eighth: 0.5, whole: 4 }[met.t('beat-unit')] ?? 1;
            tempo = parseFloat(met.t('per-minute')) * unit * (met.has('beat-unit-dot') ? 1.5 : 1);
          }
          if (isFinite(tempo) && tempo > 0 && pi === 0 && !mb.tempo) mb.tempo = tempo;
          if (pi === 0 && c.name === 'direction' && !mb.section) {
            const reh = c.find('direction-type/rehearsal')?.t();
            const words = c.find('direction-type/words')?.t();
            if (reh) mb.section = reh;
            else if (words && words.length < 30 && SECTION_RE.test(words)) mb.section = words;
          }
        } else if (c.name === 'barline' && pi === 0) {
          const rep = c.child('repeat');
          if (rep?.attr('direction') === 'forward') mb.repeatStart = true;
          if (rep?.attr('direction') === 'backward') { mb.repeatEnd = true; mb.repeatTimes = +rep.attr('times', 2) || 2; }
          const en = c.child('ending');
          if (en) {
            const type = en.attr('type');
            if (type === 'start') ending = String(en.attr('number', '1')).split(/[\s,]+/).map(Number).filter((n) => n > 0);
            else if (type === 'stop' || type === 'discontinue') endingStopsHere = true;
          }
        } else if (c.name === 'backup') cursor -= c.num('duration');
        else if (c.name === 'forward') cursor += c.num('duration');
        else if (c.name === 'note') {
          if (c.has('grace')) continue;
          const chord = c.has('chord');
          const dur = c.num('duration');
          const start = chord ? lastStart : cursor;
          if (!chord) { lastStart = cursor; cursor += dur; }
          if (+c.t('staff', '1') !== useStaff || c.t('voice', '1') !== useVoice) continue;
          if (c.has('cue')) continue;
          let beat = chord ? beats[beats.length - 1] : null;
          if (!beat || beat.start !== start) {
            beat = { start, div: dur, notes: [], rest: false, type: c.t('type'), dots: c.all('dot').length,
              tup: c.child('time-modification') };
            beats.push(beat);
          }
          if (c.has('rest')) { if (!beat.notes.length) beat.rest = true; continue; }
          beat.rest = false;
          const note = readNote(c, { drums, info, transpose, warn });
          if (note) {
            beat.notes.push(note);
            // help AI-written files: pitch should agree with string/fret
            if (note.string != null && tuning && note.pitchMidi != null) {
              const expect = tuning[tuning.length - note.string] + track.capo + note.fret;
              if (expect !== note.pitchMidi && expect - 12 !== note.pitchMidi) {
                lineWarnings.push({ line: c.line, msg: `${info.name}, bar ${mi + 1}: <pitch> does not match string ${note.string} fret ${note.fret} (expected ${midiName(expect)})` });
              }
            }
            delete note.pitchMidi;
          }
        }
      }
      if (pi === 0) {
        mb.time = time;
        if (ending) mb.ending = ending;
        if (m.attr('implicit') === 'yes' && mi === 0) mb.pickup = true;
      }
      if (endingStopsHere) ending = null;
      // to model beats (fill gaps between voice notes with rests)
      const out = [];
      let pos = 0;
      beats.sort((a, b) => a.start - b.start);
      for (const b of beats) {
        if (b.start < pos - 1e-6) continue; // overlapping, skip
        if (b.start > pos + 1e-6) out.push(...restsFor((b.start - pos) / divisions));
        const value = TYPE_VALUES[b.type];
        let dur;
        if (value) {
          const tm = b.tup;
          dur = durFromValue(value, b.dots, tm ? tm.num('actual-notes') : 0, tm ? tm.num('normal-notes') : 0, warn);
        } else {
          const r = restsFor(b.div / divisions)[0];
          dur = r ? r.dur : { base: 'q', dots: 0, tuplet: 0 };
        }
        out.push({ dur, rest: b.rest || !b.notes.length, notes: b.notes });
        pos = b.start + b.div;
      }
      track.bars.push(out);
    });
    tracks.push(track);
  });
  let cur = masterBars.find((mb) => mb.tempo)?.tempo || 120;
  meta.tempo = cur;
  for (const mb of masterBars) { if (mb.tempo) cur = mb.tempo; else mb.tempo = cur; }
  meta.time = masterBars[0]?.time || [4, 4];
  const warnings = [...warn.list().map((msg) => ({ line: 0, msg })), ...lineWarnings.slice(0, 50)];
  return { format: 'MusicXML', meta, masterBars, tracks, warnings, errors: x.errors || [] };
}

function readNote(c, { drums, info, transpose, warn }) {
  const note = {};
  const tech = c.find('notations/technical');
  if (drums) {
    const inst = c.child('instrument')?.attr('id');
    if (inst && info.unpitched[inst] != null) note.midi = info.unpitched[inst];
    else {
      const u = c.child('unpitched');
      const key = u ? u.t('display-step') + u.t('display-octave') : '';
      note.midi = DRUM_POS[key] ?? 38;
      if (!DRUM_POS[key]) warn.add(`${info.name}: some drum notes could not be identified (shown as snare)`);
    }
  } else if (tech?.has('fret') && tech?.has('string')) {
    note.string = tech.num('string');
    note.fret = tech.num('fret');
    const p = c.child('pitch');
    if (p) note.pitchMidi = (p.num('octave') + 1) * 12 + (STEP[p.t('step')] ?? 0) + Math.round(p.num('alter', 0)) + transpose;
  } else {
    const p = c.child('pitch');
    if (!p) return null;
    note.midi = (p.num('octave') + 1) * 12 + (STEP[p.t('step')] ?? 0) + Math.round(p.num('alter', 0)) + transpose;
  }
  if (c.all('tie').some((t) => t.attr('type') === 'stop') || c.find('notations')?.all('tied').some((t) => t.attr('type') === 'stop')) note.tie = true;
  const nots = c.child('notations');
  if (tech) {
    if (tech.all('hammer-on').some((h) => h.attr('type') === 'start') || tech.all('pull-off').some((h) => h.attr('type') === 'start')) note.legato = true;
    const bend = tech.child('bend');
    if (bend) note.bend = Math.max(1, Math.round(Math.abs(bend.num('bend-alter', 2))));
    if (tech.has('harmonic')) note.harmonic = true;
    if (tech.all('other-technical').some((o) => /let\s*ring/i.test(o.t()))) note.letRing = true;
    if (tech.all('other-technical').some((o) => /p\.?\s*m\.?|palm/i.test(o.t()))) note.palmMute = true;
  }
  if (/palm/i.test(c.t('play/mute'))) note.palmMute = true;
  if (nots && (nots.all('slide').some((s) => s.attr('type') === 'start') || nots.all('glissando').some((s) => s.attr('type') === 'start'))) note.slide = true;
  const orn = nots?.child('ornaments');
  if (orn && (orn.has('vibrato') || orn.all('wavy-line').some((w) => w.attr('type') === 'start'))) note.vibrato = true;
  const art = nots?.child('articulations');
  if (art && (art.has('accent') || art.has('strong-accent'))) note.accent = true;
  const head = c.child('notehead');
  if (head && !drums && head.t() === 'x') note.dead = true;
  if (head && head.attr('parentheses') === 'yes') note.ghost = true;
  return note;
}
