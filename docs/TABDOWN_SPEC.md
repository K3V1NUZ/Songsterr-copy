# TabDown format (`.tabd`) — v1

TabDown is a plain-text tab format. People can write it by hand, AIs can generate it reliably,
and it diffs nicely in git. Each song is one `.tabd` file in its own folder. The audio file sits next to it:

```
library/
  my-song/
    song.tabd
    audio.mp3      ← your own recording (stays on your PC, git-ignored)
```

## 1. Header

`key: value` lines at the top of the file. Every key is optional.

| key | example | meaning |
|---|---|---|
| `title` | `title: Greensleeves` | song title |
| `artist` | `artist: Traditional` | artist |
| `album`, `year`, `genre`, `key`, `tabber`, `difficulty`, `comment` | | free text |
| `source` | `source: https://…` | where the tab came from (for your reference only) |
| `tempo` | `tempo: 120` | starting BPM (quarter notes). Default 120 |
| `time` | `time: 4/4` | starting time signature. Default 4/4 |
| `audio` | `audio: audio.mp3` | audio file in the same folder |
| `offset` | `offset: 1.85` | seconds into the audio where **bar 1, beat 1** happens |
| `sync` | `sync: 1@1.85, 17@38.2, 33@74.9` | sync anchors: `playedBar@seconds` (see §5) |

`#` starts a comment, either at the start of a line or after a space.

## 2. Tracks

```
track: Lead Guitar        # starts a new track; everything below belongs to it
instrument: electric      # guitar | acoustic | electric | distortion | bass | ukulele | banjo | keys | drums
tuning: standard          # preset name, or notes from LOW to HIGH: D2 A2 D3 G3 B3 E4
capo: 0
volume: 0.8               # 0..1 (synth mix)
```

Tuning presets: `standard`, `drop-d`, `half-down`, `full-down`, `drop-c`, `open-g`, `open-d`,
`dadgad`, `7-string`, `bass`, `bass-5`, `bass-drop-d`, `ukulele`.
The number of notes in the tuning sets the number of strings.

**Every track must have the same number of bars.** The validator warns when they don't, and pads
shorter tracks with rests.

## 3. Bars and beats

Bars are separated by `|`. Line breaks don't matter. A common style is one to four bars per line.

```
q 6:0 6:3 e 5:0 5:2 q 5:3 | h [6:3 5:5 4:5] h r |
```

### Durations (sticky: a duration applies to all following beats until you change it)

| token | value | | token | value |
|---|---|---|---|---|
| `w` | whole | | `e` | eighth |
| `h` | half | | `s` | sixteenth |
| `q` | quarter | | `t` | thirty-second |

* Dotted: `q.` (1.5×), double-dotted `q..`
* Tuplets: `e3` = eighth-note triplet (3 in the time of 2), also `5`, `6`, `7` (`s5`, `s6`…)

### Notes: `string:fret`

**String 1 is the highest (thinnest) string.** On a 6-string guitar, string 6 is low E.

| written | meaning |
|---|---|
| `3:5` | string 3, fret 5 |
| `[6:0 5:2 4:2]` | chord: several notes in one beat. Must stay on one line |
| `r` | rest |
| `6:x` | dead / muted note |
| `3:(5)` | ghost note |
| `2:<12>` | natural harmonic |
| `3:-` | tie: holds the previous note on string 3 (no new attack) |

### Techniques (suffixes after the fret, combinable, e.g. `3:7h~`)

| suffix | meaning |
|---|---|
| `h` | hammer-on **to the next note on the same string** |
| `p` | pull-off to the next note on the same string |
| `/` or `\` | slide to the next note on the same string |
| `b` / `b1` / `b2` / `b3` | bend: `b` = `b2` = full (2 semitones), `b1` = ½ |
| `~` | vibrato |
| `m` | palm mute |
| `!` | accent |
| `l` | let ring |

### Drums (`instrument: drums`)

The notes are drum names instead of `string:fret`:
`kick (k)`, `snare (sn)`, `sidestick (ss)`, `hihat (hh)`, `ohat (oh)`, `pedal (ph)`, `crash (cr)`,
`ride (rd)`, `tom1 (t1)`, `tom2 (t2)`, `tom3 (t3/ft)`. Ghost: `(sn)`. Accent: `sn!`.

```
e [k hh] hh [sn hh] hh [k hh] [k hh] [sn hh] hh |
```

## 4. Directives, repeats and sections

Directives go inside a bar (usually at its start) in `{…}`:

| directive | meaning |
|---|---|
| `{section Chorus}` | section label (shown on the tab) |
| `{tempo 140}` | tempo change from this bar |
| `{time 6/8}` | time-signature change from this bar |
| `{ending 1}` / `{ending 2,3}` | volta: this bar is only played on those passes of the repeat |
| `{text let ring}` | free text above the bar |

Repeats:

```
|: q 6:0 6:3 6:5 r |  e … :|        # play twice
|: … :|x4                            # play four times
… :|: …                              # end one repeat and start the next
```

Directives in any track apply to the whole song. Put them in the first track.

## 5. Matching audio (offset and sync)

The cursor and the synth run on **score time**. That's the bar/beat position computed from
`tempo`, `time` and the durations. A real recording never matches it exactly, so the file
tells the app how score time maps onto audio time:

* **offset only**: bar 1 starts at `offset` seconds, and the recording is assumed to follow the tab
  tempo exactly. This works for click-tracked studio recordings.
* **sync anchors**: `sync: bar@seconds, …` pins the start of chosen bars to moments in the audio.
  Between anchors, time is interpolated linearly. Past the last anchor, the last tempo ratio
  continues. Two anchors (first and last bar) already handle a recording that is a bit faster or
  slower than the tab. Add one every 4–8 bars if the band speeds up or slows down.
  The bar numbers count **played bars**, with repeats expanded. The app's position display shows
  them as `(k/total)` when a song has repeats.

You normally don't write these by hand. Open the **Sync** panel in the app and press **Tap** (or `K`)
on the downbeat of every few bars while the recording plays, then click **Save sync to file**.

## 6. Validate

```bash
node tools/validate.js library/my-song/song.tabd
```

The validator reports syntax errors with line numbers and checks that every bar adds up to its time signature.
The editor in the app shows the same checks live.
