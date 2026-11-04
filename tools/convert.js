#!/usr/bin/env node
// Convert Guitar Pro / MusicXML / ASCII tab to MusicXML:
//   node tools/convert.js song.gp5 song.musicxml
//   node tools/convert.js tab.txt song.musicxml --ascii --title "Song" --tempo 120 --time 4/4
// (You don't need this to play Guitar Pro files — the app reads them directly.
//  It is useful when you want an editable MusicXML version.)
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { importScoreFile, modelToMusicXML } from '../public/js/importers/index.js';
import { asciiToModel } from '../public/js/ascii.js';

const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
const [input, output] = a.filter((x, i) => !x.startsWith('--') && !a[i - 1]?.match(/^--(title|artist|tempo|time)$/));
if (!input || !output) { console.error('usage: node tools/convert.js <in.gp5|.gpx|.gp|.mxl|.musicxml|tab.txt> <out.musicxml> [--ascii --title T --artist A --tempo 120 --time 4/4]'); process.exit(2); }
const model = a.includes('--ascii')
  ? asciiToModel(readFileSync(input, 'utf8'), { title: opt('--title'), artist: opt('--artist'), tempo: +opt('--tempo', 100), time: opt('--time', '4/4').split('/').map(Number) })
  : await importScoreFile(basename(input), readFileSync(input));
if (model.error) { console.error(model.error); process.exit(1); }
writeFileSync(output, modelToMusicXML(model));
console.error(`${model.format}: "${model.meta.title}", ${model.masterBars.length} bars, ${model.tracks.length} track(s) -> ${output}`);
