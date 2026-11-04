#!/usr/bin/env node
// Quick sanity tests for the parser, repeat expansion, sync mapping and ASCII converter.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { parseTabDown, setHeaderLine } from '../public/js/tabdown.js';
import { buildTimeline, playOrder, makeSyncMap, buildNoteEvents } from '../public/js/timeline.js';
import { asciiToTabDown } from '../public/js/ascii.js';
import { importScoreFile, modelToTabDown } from '../public/js/importers/index.js';

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('  ✓ ' + name); };

await test('parses notes, chords, durations, techniques', () => {
  const { song, errors } = parseTabDown('tempo: 60\ntrack: G\nq 6:0 e [5:2 4:2] 3:5h s 3:7 3:x q. 2:<12>~ |');
  assert.deepEqual(errors, []);
  const b = song.tracks[0].bars[0].beats;
  assert.equal(b.length, 6);
  assert.equal(b[0].notes[0].midi, 40);          // low E
  assert.equal(b[1].notes.length, 2);
  assert.equal(b[2].notes[0].hammer, true);
  assert.equal(b[4].notes[0].dead, true);
  assert.equal(b[5].q, 1.5);
});
await test('string 1 is the highest string', () => {
  const { song } = parseTabDown('track: G\nw 1:0 |');
  assert.equal(song.tracks[0].bars[0].beats[0].notes[0].midi, 64); // E4
});
await test('reports errors with line numbers', () => {
  const { errors } = parseTabDown('track: G\nq 7:0 1:0 1:0 1:0 |\nq 2:3z |');
  assert.equal(errors.length, 2);
  assert.equal(errors[0].line, 2);
  assert.equal(errors[1].line, 3);
});
await test('warns about wrong bar lengths', () => {
  const { warnings } = parseTabDown('time: 3/4\ntrack: G\nq 1:0 1:0 1:0 1:0 |');
  assert.equal(warnings.length, 1);
});
await test('repeats and endings expand correctly', () => {
  assert.deepEqual(playOrder([{ repeatStart: 1 }, { repeatEnd: 1, repeatTimes: 3 }, {}]), [0, 1, 0, 1, 0, 1, 2]);
  assert.deepEqual(playOrder([{ repeatStart: 1 }, { ending: [1], repeatEnd: 1 }, { ending: [2] }, {}]), [0, 1, 0, 2, 3]);
});
await test('sync map: offset and anchors', () => {
  const { song } = parseTabDown('tempo: 60\ntime: 4/4\noffset: 2\ntrack: G\nw r | w r | w r |');
  let m = makeSyncMap(buildTimeline(song), song.meta);
  assert.equal(m.toAudio(0), 2);
  assert.equal(m.toScore(6), 4);
  song.meta.sync = [{ bar: 1, time: 1 }, { bar: 3, time: 11 }]; // 8 s of score -> 10 s of audio
  m = makeSyncMap(buildTimeline(song), song.meta);
  assert.equal(m.toAudio(4), 6);
  assert.equal(m.toAudio(12), 16);                // extrapolated
  assert.ok(Math.abs(m.toScore(m.toAudio(5.3)) - 5.3) < 1e-9);
});
await test('ties extend the previous note', () => {
  const { song } = parseTabDown('tempo: 60\ntrack: G\nh 3:5 3:- |');
  const ev = buildNoteEvents(buildTimeline(song), song);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].dur, 4);
});
await test('setHeaderLine inserts and replaces', () => {
  let t = 'title: X\ntempo: 90\n\ntrack: G\nq 1:0 |';
  t = setHeaderLine(t, 'sync', '1@2.000');
  assert.match(t, /tempo: 90\nsync: 1@2.000\n/);
  t = setHeaderLine(t, 'sync', '1@3.000');
  assert.equal((t.match(/sync:/g) || []).length, 1);
  t = setHeaderLine(t, 'sync', null);
  assert.ok(!t.includes('sync:'));
});
await test('ASCII tab conversion fills bars exactly', () => {
  const r = asciiToTabDown('e|-0-0-0-0-|\nB|---------|\nG|---------|\nD|---------|\nA|---------|\nE|---------|');
  const { errors, warnings } = parseTabDown(r.text);
  assert.deepEqual(errors, []); assert.deepEqual(warnings, []);
});
await test('all library songs parse without errors', () => {
  for (const d of readdirSync('library')) {
    const f = `library/${d}/song.tabd`;
    if (!existsSync(f)) continue;
    const { errors, warnings } = parseTabDown(readFileSync(f, 'utf8'));
    assert.deepEqual(errors, [], f); assert.deepEqual(warnings, [], f);
  }
});

// ---- importers: fixtures were made from library/demo-riff and library/greensleeves
// (GP3-5 with PyGuitarPro, GP6/7 + MusicXML with independent writers); importing
// them must give back exactly the same notes as the original TabDown file.
const signature = (song) => song.tracks.map((t) => t.bars.map((b) => b.beats.map((bt) =>
  `${bt.dur.base}${bt.dur.dots}${bt.dur.tuplet}:` + (bt.rest ? 'r' : bt.notes.map((x) => x.drum ||
    `${x.string}/${x.tie ? '-' : x.dead ? 'x' : x.fret}/${['hammer', 'pull', 'slide', 'bend', 'palmMute', 'vibrato', 'harmonic', 'ghost'].filter((f) => x[f]).join(',')}`).sort().join('+'))).join(' ')));
const strip = (sig, feats) => sig.map((t) => t.map((bar) => feats ? bar : bar.replace(/\/[a-zA-Z,]*(?=[+ ]|$)/g, '/')));
for (const [file, orig, notech] of [
  ['demo-riff.gp3', 'demo-riff', true], ['demo-riff.gp4', 'demo-riff'], ['demo-riff.gp5', 'demo-riff'], ['demo-riff-v500.gp5', 'demo-riff'],
  ['demo-riff.gpx', 'demo-riff'], ['demo-riff.gp', 'demo-riff'], ['greensleeves.mxl', 'greensleeves', true],
]) {
  await test(`import ${file} round-trips exactly`, async () => {
    const model = await importScoreFile(file, readFileSync(`tests/fixtures/${file}`));
    const { text } = modelToTabDown(model);
    const res = parseTabDown(text);
    assert.deepEqual(res.errors, []); assert.deepEqual(res.warnings, []);
    const a = parseTabDown(readFileSync(`library/${orig}/song.tabd`, 'utf8')).song;
    const gp3 = file.endsWith('.gp3'); // GP3 has no palm mute / vibrato / harmonic flags per note
    const norm = (song) => signature(song).map((t) => t.map((bar) => gp3 ? bar.replace(/palmMute,?|vibrato,?|harmonic,?/g, '').replace(/,(?=\+| |$)/g, '') : bar));
    if (notech) {
      assert.deepEqual(strip(norm(res.song), false), strip(norm(a), false));
      if (gp3) assert.deepEqual(norm(res.song), norm(a));
    } else assert.deepEqual(signature(res.song), signature(a));
    assert.deepEqual(res.song.masterBars.map((m) => [m.time, m.tempo, m.section, !!m.repeatEnd, m.ending]),
      a.masterBars.map((m) => [m.time, m.tempo, m.section, !!m.repeatEnd, m.ending]));
  });
}
await test('MusicXML: tab staff, tuning and techniques', async () => {
  const model = await importScoreFile('t.musicxml', readFileSync('tests/fixtures/techniques.musicxml'));
  const { text } = modelToTabDown(model);
  assert.match(text, /tuning: drop-d/);
  assert.match(text, /\|: \{section Intro\} q 3:7h 3:9 e \[5:0 6:0\] r q 2:7b~ \| \{ending 1\} h 2:- 4:9\/ :\|/);
  assert.match(text, /\{ending 2\} q3 4:9 4:7 4:5 h 6:x \|/);
});
await test('MusicXML without tab data gets playable frets', async () => {
  const model = await importScoreFile('t.xml', Buffer.from(`<score-partwise><part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list>
    <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note><pitch><step>E</step><octave>2</octave></pitch><duration>2</duration><type>half</type></note>
    <note><pitch><step>G</step><octave>3</octave></pitch><duration>2</duration><type>half</type></note>
    <note><chord/><pitch><step>B</step><octave>3</octave></pitch><duration>2</duration><type>half</type></note></measure></part></score-partwise>`));
  const { text } = modelToTabDown(model);
  assert.match(text, /h 6:0 \[(3:0 2:0|2:0 3:0)\] \|/);
});
console.log(`\n${n} tests passed`);
