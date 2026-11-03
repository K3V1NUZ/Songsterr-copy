You are converting a guitar tab into **TabDown** (`.tabd`), a plain-text tab format.
I'll give you a link to a tab, screenshots of it, or the tab as text (ASCII tab, Guitar Pro export, etc.).
This is for my private, offline practice library.

If you can't open the link or read the notes reliably, don't guess. Tell me, and ask for
screenshots of the tab (one per instrument, whole song) or a text export instead.

## Output

Reply with exactly one fenced code block that contains the complete `.tabd` file. After the block,
add a short list of anything you were unsure about.

## Format rules

```
title: <song title>
artist: <artist>
tempo: <BPM from the tab>
time: <starting time signature, e.g. 4/4>
source: <the link I gave you>

track: <instrument name as shown on the tab, e.g. "Lead Guitar (Distortion)">
instrument: <guitar | acoustic | electric | distortion | bass | ukulele | keys | drums>
tuning: <preset (standard, drop-d, half-down, full-down, drop-c, open-g, open-d, dadgad, bass, bass-5, bass-drop-d) or notes LOW→HIGH e.g. D2 A2 D3 G3 B3 E4>
capo: <fret, if any>

<bars>
```

* Bars are separated by `|`. Put 2–4 bars per line. Start each section on a new line with `{section Name}`.
* Durations are sticky tokens placed before the notes they apply to:
  `w` whole, `h` half, `q` quarter, `e` eighth, `s` 16th, `t` 32nd.
  Dotted: `q.`. Triplets: `e3` (eighth triplet), `s3`, `q3`.
* Notes are `string:fret`. **String 1 is the HIGHEST string** (high e on guitar, G on 4-string bass).
  Chords: `[6:0 5:2 4:2]` (one line). Rest: `r`. Dead note: `5:x`. Ghost: `3:(5)`.
  Harmonic: `3:<12>`. Tied/held note: `3:-`.
* Technique suffixes go right after the fret: `h` hammer-on to the next note on that string,
  `p` pull-off, `/` slide, `b` full bend, `b1` half bend, `~` vibrato, `m` palm mute,
  `!` accent, `l` let ring. You can combine them: `3:7b~`.
* Drums use names instead of string:fret: `kick snare hihat ohat crash ride tom1 tom2 tom3 sidestick pedal`
  (short forms: `k sn hh oh cr rd t1 t2 ft ss ph`). Example: `e [k hh] hh [sn hh] hh`.
* Tempo or time-signature changes go at the start of the bar: `{tempo 140}`, `{time 6/8}`.
* Repeats: `|: … :|` (twice), `:|x4` (four times). Alternate endings: `{ending 1}`, `{ending 2}`.
  If the tab is written out in full without repeat signs, write it out in full too.
* `#` starts a comment.

## Hard requirements (check before answering)

1. **Every bar's durations must add up to the time signature exactly.** For example, 4/4 = 4 quarters =
   8 eighths, and 6/8 = 6 eighths = `q. q.`. Fill gaps with rests (`r`). Count every bar.
2. **Every track must have the same number of bars**, in the same order. If an instrument is silent
   for a section, write whole-bar rests (`w r` in 4/4, `h. r` in 3/4, and so on).
3. Include every track I asked for (default: all guitar and bass tracks). Put the
   tempo/time/section directives in the first track.
4. Pay attention to the string order (1 = highest) and the tuning. A bass tab with 4 lines uses
   strings 1–4 with `tuning: bass`.
5. Don't add `audio`, `offset` or `sync` lines. I set those up in the app.

If you can run code, check your file with `node tools/validate.js song.tabd` from the Fretline
folder, and fix any errors or warnings before you reply.

## Example

```
title: Example
artist: Someone
tempo: 96
time: 4/4

track: Guitar
instrument: acoustic
tuning: standard

{section Intro} e 5:0 3:2 2:1 1:0 2:1 3:2 5:0 3:2 | 6:3 4:0 3:0 2:0 q [6:3 5:2 4:0 3:0 2:0 1:3] r |
{section Riff} |: s 3:5h 3:7 e 3:5 q 2:8b 2:8 e 2:5 2:8 :|
w [6:0 5:2 4:2 3:1 2:0 1:0] |

track: Bass
instrument: bass
tuning: bass

q 3:0 3:0 3:0 3:0 | 4:3 4:3 h r |
|: q 3:0 e 3:0 3:0 h 3:2 :|
w 4:0 |
```
