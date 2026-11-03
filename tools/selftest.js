#!/usr/bin/env node
// Quick sanity tests for the parser, repeat expansion, sync mapping and ASCII converter.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { parseTabDown, setHeaderLine } from '../public/js/tabdown.js';
import { buildTimeline, playOrder, makeSyncMap, buildNoteEvents } from '../public/js/timeline.js';
import { asciiToTabDown } from '../public/js/ascii.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

test('parses notes, chords, durations, techniques', () => {
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
test('string 1 is the highest string', () => {
  const { song } = parseTabDown('track: G\nw 1:0 |');
  assert.equal(song.tracks[0].bars[0].beats[0].notes[0].midi, 64); // E4
});
test('reports errors with line numbers', () => {
  const { errors } = parseTabDown('track: G\nq 7:0 1:0 1:0 1:0 |\nq 2:3z |');
  assert.equal(errors.length, 2);
  assert.equal(errors[0].line, 2);
  assert.equal(errors[1].line, 3);
});
test('warns about wrong bar lengths', () => {
  const { warnings } = parseTabDown('time: 3/4\ntrack: G\nq 1:0 1:0 1:0 1:0 |');
  assert.equal(warnings.length, 1);
});
test('repeats and endings expand correctly', () => {
  assert.deepEqual(playOrder([{ repeatStart: 1 }, { repeatEnd: 1, repeatTimes: 3 }, {}]), [0, 1, 0, 1, 0, 1, 2]);
  assert.deepEqual(playOrder([{ repeatStart: 1 }, { ending: [1], repeatEnd: 1 }, { ending: [2] }, {}]), [0, 1, 0, 2, 3]);
});
test('sync map: offset and anchors', () => {
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
test('ties extend the previous note', () => {
  const { song } = parseTabDown('tempo: 60\ntrack: G\nh 3:5 3:- |');
  const ev = buildNoteEvents(buildTimeline(song), song);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].dur, 4);
});
test('setHeaderLine inserts and replaces', () => {
  let t = 'title: X\ntempo: 90\n\ntrack: G\nq 1:0 |';
  t = setHeaderLine(t, 'sync', '1@2.000');
  assert.match(t, /tempo: 90\nsync: 1@2.000\n/);
  t = setHeaderLine(t, 'sync', '1@3.000');
  assert.equal((t.match(/sync:/g) || []).length, 1);
  t = setHeaderLine(t, 'sync', null);
  assert.ok(!t.includes('sync:'));
});
test('ASCII tab conversion fills bars exactly', () => {
  const r = asciiToTabDown('e|-0-0-0-0-|\nB|---------|\nG|---------|\nD|---------|\nA|---------|\nE|---------|');
  const { errors, warnings } = parseTabDown(r.text);
  assert.deepEqual(errors, []); assert.deepEqual(warnings, []);
});
test('all library songs parse without errors', () => {
  for (const d of readdirSync('library')) {
    const f = `library/${d}/song.tabd`;
    if (!existsSync(f)) continue;
    const { errors, warnings } = parseTabDown(readFileSync(f, 'utf8'));
    assert.deepEqual(errors, [], f); assert.deepEqual(warnings, [], f);
  }
});
console.log(`\n${n} tests passed`);
