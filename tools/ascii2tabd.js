#!/usr/bin/env node
// Convert an ASCII tab text file to TabDown:
//   node tools/ascii2tabd.js tab.txt [--title "Song"] [--artist "Band"] [--tempo 120] [--time 4/4] > song.tabd
import { readFileSync } from 'node:fs';
import { asciiToTabDown } from '../public/js/ascii.js';
const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
if (!a[0]) { console.error('usage: node tools/ascii2tabd.js tab.txt [--title T] [--artist A] [--tempo 120] [--time 4/4]'); process.exit(2); }
const res = asciiToTabDown(readFileSync(a[0], 'utf8'), {
  title: opt('--title'), artist: opt('--artist'), tempo: +opt('--tempo', 100), time: opt('--time', '4/4').split('/').map(Number),
});
if (res.error) { console.error(res.error); process.exit(1); }
process.stdout.write(res.text);
