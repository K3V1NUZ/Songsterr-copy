#!/usr/bin/env node
// Validate one or more TabDown files:  node tools/validate.js library/*/song.tabd
// Exit code 1 if any file has errors. Handy for AI converters to self-check.
import { readFileSync } from 'node:fs';
import { parseTabDown } from '../public/js/tabdown.js';
import { buildTimeline } from '../public/js/timeline.js';

const files = process.argv.slice(2);
if (!files.length) { console.log('usage: node tools/validate.js <file.tabd> [...]'); process.exit(2); }
let bad = 0;
for (const f of files) {
  const { song, errors, warnings } = parseTabDown(readFileSync(f, 'utf8'));
  const tl = buildTimeline(song);
  const m = song.meta;
  console.log(`\n${f}\n  "${m.title}" by ${m.artist || '?'} — ${song.masterBars.length} bars (${tl.played.length} played with repeats), ` +
    `${fmt(tl.duration)} at tab tempo`);
  for (const t of song.tracks) {
    const notes = t.bars.reduce((a, b) => a + b.beats.reduce((x, bt) => x + bt.notes.length, 0), 0);
    console.log(`  • ${t.name} [${t.instrument}${t.tuning.length ? ', ' + t.tuning.length + ' strings' : ''}] ${notes} notes`);
  }
  for (const e of errors) console.log(`  ERROR   line ${e.line}: ${e.msg}`);
  for (const w of warnings) console.log(`  warning line ${w.line}: ${w.msg}`);
  if (!errors.length && !warnings.length) console.log('  OK — no problems found');
  if (errors.length) bad++;
}
function fmt(s) { return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`; }
process.exit(bad ? 1 : 0);
