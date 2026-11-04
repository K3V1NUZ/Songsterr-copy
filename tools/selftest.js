#!/usr/bin/env node
// Sanity tests: importers (MusicXML + Guitar Pro 3-8), the MusicXML writer,
// repeat expansion, audio sync mapping and the ASCII converter.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadScore, importScoreFile, modelToMusicXML } from '../public/js/importers/index.js';
import { durationQuarters, noteToMidi, parseTuning } from '../public/js/music.js';
import { buildTimeline, playOrder, makeSyncMap, buildNoteEvents } from '../public/js/timeline.js';
import { asciiToModel } from '../public/js/ascii.js';

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };
const enc = (s) => new TextEncoder().encode(s);
const load = async (file) => loadScore(file, readFileSync(file));
const STD = '<clef><sign>TAB</sign><line>5</line></clef><staff-details><staff-lines>6</staff-lines>' +
  [['E', 2], ['A', 2], ['D', 3], ['G', 3], ['B', 3], ['E', 4]].map(([st, o], i) => `<staff-tuning line="${i + 1}"><tuning-step>${st}</tuning-step><tuning-octave>${o}</tuning-octave></staff-tuning>`).join('') + '</staff-details>';
const xml = (measures, { attrs = '<divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time>' + STD, head = '' } = {}) => enc(
  `<score-partwise><part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>
   <part id="P1">${measures.map((m, i) => `<measure number="${i + 1}">${i === 0 ? `<attributes>${attrs}</attributes>${head}` : ''}${m}</measure>`).join('')}</part></score-partwise>`);
const tabNote = (s, f, dur = 2, extra = '') => `<note><duration>${dur}</duration><notations><technical><string>${s}</string><fret>${f}</fret>${extra}</technical></notations></note>`;

// one signature string per bar, used to compare whole songs
const TECH = ['tie', 'dead', 'ghost', 'harmonic', 'hammer', 'pull', 'slide', 'bend', 'vibrato', 'palmMute', 'accent', 'letRing'];
const signature = (song, tech = TECH) => song.tracks.map((t) => t.bars.map((b) => b.beats.every((bt) => bt.rest) ? 'rest' : b.beats.map((bt) =>
  `${bt.dur.base}${bt.dur.dots}${bt.dur.tuplet}:` + (bt.rest ? 'r' : bt.notes.map((x) => x.drum ||
    `${x.string}/${x.fret}/${tech.filter((f) => x[f]).join(',')}`).sort().join('+'))).join(' ')));
const masters = (song) => song.masterBars.map((m) => [m.time, m.tempo, m.section ?? null, !!m.repeatStart, !!m.repeatEnd, m.repeatEnd ? m.repeatTimes || 2 : 0, m.ending ?? null]);

await test('music helpers', () => {
  assert.equal(durationQuarters('q', 1), 1.5);
  assert.equal(durationQuarters('e', 0, 3), 1 / 3);
  assert.equal(noteToMidi('E2'), 40);
  assert.deepEqual(parseTuning('drop-d'), [38, 45, 50, 55, 59, 64]);
});
await test('repeats and endings expand correctly', () => {
  assert.deepEqual(playOrder([{ repeatStart: 1 }, { repeatEnd: 1, repeatTimes: 3 }, {}]), [0, 1, 0, 1, 0, 1, 2]);
  assert.deepEqual(playOrder([{ repeatStart: 1 }, { ending: [1], repeatEnd: 1 }, { ending: [2] }, {}]), [0, 1, 0, 2, 3]);
});
await test('sync map: offset and anchors', async () => {
  const { song } = await loadScore('t.musicxml', xml(['<note><rest measure="yes"/><duration>8</duration></note>', '', ''], { head: '<sound tempo="60"/>' }));
  song.meta.offset = 2;
  let m = makeSyncMap(buildTimeline(song), song.meta);
  assert.equal(m.toAudio(0), 2);
  assert.equal(m.toScore(6), 4);
  song.meta.sync = [{ bar: 1, time: 1 }, { bar: 3, time: 11 }]; // 8 s of score -> 10 s of audio
  m = makeSyncMap(buildTimeline(song), song.meta);
  assert.equal(m.toAudio(4), 6);
  assert.equal(m.toAudio(12), 16);
  assert.ok(Math.abs(m.toScore(m.toAudio(5.3)) - 5.3) < 1e-9);
});
await test('ties extend the previous note', async () => {
  const { song } = await loadScore('t.musicxml', xml([
    `<note><duration>4</duration><tie type="start"/><type>half</type><notations><technical><string>3</string><fret>5</fret></technical></notations></note>
     <note><duration>4</duration><tie type="stop"/><type>half</type><notations><technical><string>3</string><fret>5</fret></technical></notations></note>`], { head: '<sound tempo="60"/>' }));
  const ev = buildNoteEvents(buildTimeline(song), song);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].dur, 4);
});
await test('library songs load without problems', async () => {
  for (const d of readdirSync('library')) {
    const r = await load(`library/${d}/song.musicxml`);
    assert.deepEqual(r.errors, [], d); assert.deepEqual(r.warnings, [], d);
  }
});
await test('MusicXML writer round-trips the library songs exactly', async () => {
  for (const d of readdirSync('library')) {
    const a = await load(`library/${d}/song.musicxml`);
    const b = await loadScore('x.musicxml', enc(modelToMusicXML(a.model)));
    assert.deepEqual(b.errors, []); assert.deepEqual(b.warnings, []);
    assert.deepEqual(signature(b.song), signature(a.song), d);
    assert.deepEqual(masters(b.song), masters(a.song), d);
  }
});

// Fixtures were made from the library songs: GP3-5 written by PyGuitarPro, GP6/7
// by a separate GPIF generator, .mxl by music21. Each must give back the same notes.
const reference = {
  'demo-riff': (await load('library/demo-riff/song.musicxml')).song,
  greensleeves: (await load('library/greensleeves/song.musicxml')).song,
};
for (const [file, ref, tech] of [
  ['demo-riff.gp3', 'demo-riff', ['tie', 'dead', 'ghost', 'hammer', 'pull', 'slide', 'bend', 'accent']], // GP3 has no P.M./vibrato/harmonic per note
  ['demo-riff.gp4', 'demo-riff'], ['demo-riff.gp5', 'demo-riff'], ['demo-riff-v500.gp5', 'demo-riff'],
  ['demo-riff.gpx', 'demo-riff'], ['demo-riff.gp', 'demo-riff'],
  ['greensleeves.mxl', 'greensleeves', ['tie', 'accent']], // music21 does not write hammer-ons
]) {
  await test(`import ${file} matches the original exactly`, async () => {
    const r = await load(`tests/fixtures/${file}`);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(signature(r.song, tech), signature(reference[ref], tech));
    assert.deepEqual(masters(r.song), masters(reference[ref]));
  });
}
await test('MusicXML: tab staff, tuning and techniques', async () => {
  const r = await load('tests/fixtures/techniques.musicxml');
  assert.deepEqual(r.errors, []); assert.deepEqual(r.warnings, []);
  const t = r.song.tracks[0];
  assert.deepEqual(t.tuning, parseTuning('drop-d'));
  assert.deepEqual(signature(r.song)[0], [
    'q00:3/7/hammer q00:3/9/ e00:5/0/+6/0/ e00:r q00:2/7/bend,vibrato',
    'h00:2/7/tie h00:4/9/slide',
    'q03:4/9/ q03:4/7/ q03:4/5/ h00:6/0/dead',
  ]);
  assert.deepEqual(masters(r.song).map((m) => [m[2], m[3], m[4], m[6]]), [['Intro', true, false, null], [null, false, true, [1]], [null, false, false, [2]]]);
});
await test('minimal AI-style MusicXML (no <pitch>, no <type>) loads', async () => {
  const r = await loadScore('ai.musicxml', xml([tabNote(6, 0) + tabNote(6, 3) + tabNote(5, 0, 1) + tabNote(5, 2, 1) + tabNote(5, 3)]));
  assert.deepEqual(r.errors, []); assert.deepEqual(r.warnings, []);
  assert.deepEqual(signature(r.song)[0], ['q00:6/0/ q00:6/3/ e00:5/0/ e00:5/2/ q00:5/3/']);
});
await test('reports bars that do not add up, with line numbers', async () => {
  const r = await loadScore('bad.musicxml', xml([tabNote(6, 0) + tabNote(6, 3)]));
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0].msg, /bar 1: notes add up to 2 quarters but 4\/4 needs 4 quarters/);
  assert.ok(r.warnings[0].line > 0);
});
await test('reports broken XML with line numbers', async () => {
  const r = await loadScore('broken.musicxml', enc('<score-partwise>\n<part-list><score-part id="P1"><part-name>G</part-name></score-part></part-list>\n<part id="P1"><measure number="1">\n<note><duration>8</duration></measure></part></score-partwise>'));
  assert.ok(r.errors.some((e) => e.line === 4 && /<note> is never closed/.test(e.msg)));
});
await test('warns when <pitch> does not match string/fret', async () => {
  const note = '<note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><notations><technical><string>1</string><fret>0</fret></technical></notations></note>';
  const r = await loadScore('p.musicxml', xml([note]));
  assert.match(r.warnings[0].msg, /does not match string 1 fret 0 \(expected E4\)/);
});
await test('sheet music without tab data gets playable frets', async () => {
  const r = await loadScore('t.xml', xml([
    `<note><pitch><step>E</step><octave>2</octave></pitch><duration>4</duration><type>half</type></note>
     <note><pitch><step>G</step><octave>3</octave></pitch><duration>4</duration><type>half</type></note>
     <note><chord/><pitch><step>B</step><octave>3</octave></pitch><duration>4</duration><type>half</type></note>`]));
  assert.deepEqual(signature(r.song)[0], ['h00:6/0/ h00:2/0/+3/0/']);
});
await test('ASCII tab -> MusicXML fills bars exactly', async () => {
  const model = asciiToModel('e|-0-0-0-0-|\nB|-------3-|\nG|---------|\nD|---------|\nA|---------|\nE|---------|');
  const r = await loadScore('a.musicxml', enc(modelToMusicXML(model)));
  assert.deepEqual(r.errors, []); assert.deepEqual(r.warnings, []);
  assert.deepEqual(signature(r.song)[0], ['q00:1/0/ q00:1/0/ q00:1/0/ q00:1/0/+2/3/']);
});
await test('Guitar Pro model keeps track names and tunings', async () => {
  const m = await importScoreFile('x.gp5', readFileSync('tests/fixtures/demo-riff.gp5'));
  assert.deepEqual(m.tracks.map((t) => t.name), ['Rhythm Guitar', 'Lead Guitar', 'Bass', 'Drums']);
  assert.deepEqual(m.tracks[0].tuning, parseTuning('drop-d'));
});
console.log(`\n${n} tests passed`);
