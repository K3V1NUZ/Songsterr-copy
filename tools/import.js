#!/usr/bin/env node
// Convert Guitar Pro / MusicXML to TabDown:
//   node tools/import.js song.gp5                 -> lists tracks, writes all to stdout
//   node tools/import.js song.gp5 --tracks 1,3    -> only tracks 1 and 3
//   node tools/import.js song.mxl -o library/my-song/song.tabd
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { importScoreFile, modelToTabDown } from '../public/js/importers/index.js';
import { parseTabDown } from '../public/js/tabdown.js';

const a = process.argv.slice(2);
const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
const file = a.find((x, i) => !x.startsWith('-') && !['--tracks', '-o'].includes(a[i - 1]));
if (!file) { console.error('usage: node tools/import.js <file.gp5|.gpx|.gp|.musicxml|.mxl> [--tracks 1,2] [-o out.tabd]'); process.exit(2); }
const model = await importScoreFile(basename(file), readFileSync(file));
console.error(`${model.format}: "${model.meta.title}"${model.meta.artist ? ' by ' + model.meta.artist : ''}, ${model.masterBars.length} bars`);
model.tracks.forEach((t, i) => console.error(`  ${i + 1}. ${t.name} [${t.instrument}${t.tuning.length ? ', ' + t.tuning.length + ' strings' : ''}] ${t.noteCount} notes`));
const sel = opt('--tracks') ? opt('--tracks').split(',').map((x) => +x - 1) : undefined;
const { text, warnings } = modelToTabDown(model, { trackIndexes: sel, source: basename(file) });
warnings.forEach((w) => console.error('  note: ' + w));
const check = parseTabDown(text);
check.errors.forEach((e) => console.error(`  ERROR line ${e.line}: ${e.msg}`));
console.error(`  -> ${check.errors.length} errors, ${check.warnings.length} warnings after conversion`);
if (opt('-o')) { mkdirSync(dirname(opt('-o')), { recursive: true }); writeFileSync(opt('-o'), text); console.error('  wrote ' + opt('-o')); }
else process.stdout.write(text);
