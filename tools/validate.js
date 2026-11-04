#!/usr/bin/env node
// Check one or more score files (MusicXML or Guitar Pro):
//   node tools/validate.js library/*/song.musicxml
// Reports broken XML, bars that don't add up to their time signature and
// pitches that don't match their string/fret. Exit code 1 if any file has errors.
// Handy for an AI that writes MusicXML: run this on its own output and fix what it reports.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { loadScore } from '../public/js/importers/index.js';
import { buildTimeline } from '../public/js/timeline.js';

const files = process.argv.slice(2);
if (!files.length) { console.log('usage: node tools/validate.js <score.musicxml|.mxl|.gp5|…> [...]'); process.exit(2); }
let bad = 0;
for (const f of files) {
  const r = await loadScore(basename(f), readFileSync(f));
  console.log(`\n${f}`);
  if (r.song) {
    const tl = buildTimeline(r.song);
    const m = r.song.meta;
    console.log(`  ${r.format}: "${m.title}" by ${m.artist || '?'} — ${r.song.masterBars.length} bars (${tl.played.length} played with repeats), ${fmt(tl.duration)} at ${m.tempo} BPM`);
    r.song.tracks.forEach((t, i) => {
      const notes = t.bars.reduce((a, b) => a + b.beats.reduce((x, bt) => x + bt.notes.length, 0), 0);
      console.log(`  • ${t.name} [${t.instrument}${t.tuning.length ? ', ' + t.tuning.length + ' strings' : ''}${t.capo ? ', capo ' + t.capo : ''}] ${notes} notes`);
    });
  }
  const where = (x) => (x.line ? `line ${x.line}: ` : '');
  for (const e of r.errors) console.log(`  ERROR   ${where(e)}${e.msg}`);
  for (const w of r.warnings) console.log(`  warning ${where(w)}${w.msg}`);
  if (!r.errors.length && !r.warnings.length) console.log('  OK — no problems found');
  if (r.errors.length || !r.song) bad++;
}
function fmt(s) { return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`; }
process.exit(bad ? 1 : 0);
