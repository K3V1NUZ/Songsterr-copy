# Fretline

Fretline is a free, offline tab player for your own personal tab library. It's built for guitar,
and it also handles bass, ukulele, keys and drums.
It uses a simple classic layout: a search bar at the top, the tab in the middle, and the transport at the bottom.

* Tab view with rhythm stems, techniques (H/P, slides, bends, vibrato, P.M., harmonics), repeats,
  alternate endings, and tempo and time-signature changes
* A **cursor that follows the music** and auto-scrolls row by row
* Play along with **your own MP3** or the built-in synth, or both at once to check the sync
* **Count-in**, metronome, speed 25–150% (the recording keeps its pitch), drag across bars to **loop**
* **Multiple guitars per song**: an instrument switcher with solo and mute
* Sync tools that **match the tab to the recording**: set the offset, tap along, use sync points
* Songs are **standard files**: **MusicXML** (`.musicxml`, `.xml`, `.mxl`) or **Guitar Pro** (GP3, GP4, GP5, GPX, GP7/8),
  played as they are with exact rhythms and techniques. An AI can write MusicXML for you, and ASCII tabs convert to MusicXML
* No accounts, no scraping, no internet needed

## Run it

You need [Node.js](https://nodejs.org) 18 or newer. It has no dependencies, so there's no `npm install`.

```bash
npm start
```

Then open http://localhost:4173. The songs live in `library/`, one folder per song:

```
library/greensleeves/
  song.musicxml    the score (or any .musicxml .xml .mxl .gp .gp3 .gp4 .gp5 .gpx file)
  audio.mp3        your recording (optional, stays on your PC)
  fretline.json    audio-sync settings the app writes for you: {"audio", "offset", "sync"}
```

You can also just make a folder, drop a score file and an MP3 in it, and it shows up in the search.

The repo doesn't include an audio file. To try the audio sync with the Greensleeves example, generate a demo recording.
It has a 2-second intro gap and is 4% slower than the tab, like a real recording would be:

```bash
npm run demo-audio
```

## Add a song

The workflow:

1. **Get a score file.** You have three options:
   * **A MusicXML or Guitar Pro file you already have.** Export from MuseScore, Guitar Pro, TuxGuitar and so on.
     Rhythms, ties, tunings, capo, repeats, alternate endings, tempo changes, sections, drums and techniques
     (hammer-ons, pull-offs, slides, bends, vibrato, palm mutes, harmonics, dead and ghost notes) all carry over.
     Sheet music without tab data gets playable string/fret positions automatically.
   * **Ask an AI.** In the app, go to **Import → Convert with AI**, copy the prompt, and give it to an AI together with
     the link to the tab you want. If it can't open the page, give it screenshots. It answers with a MusicXML file
     ([the prompt](docs/AI_CONVERSION_PROMPT.md) includes a MusicXML cheat sheet and template).
   * **ASCII tab.** Go to **Import → Convert ASCII tab**. The notes come out exact, but the rhythm is estimated.
     The command-line version is `node tools/convert.js tab.txt song.musicxml --ascii --title "…" --tempo 120`.
2. **Add it to the library.** Go to **Import**, and either drop or choose the file, or paste the MusicXML text under
   **Paste MusicXML**. Problems are listed live, and you can click one to jump to its line. The checks cover broken XML,
   bars that don't add up to their time signature, and `<pitch>` values that don't match the string/fret.
   You can run the same check from the command line with `node tools/validate.js song.musicxml`, which is handy for an AI that can run code.
   **Edit** opens the song's MusicXML source. A Guitar Pro song is shown converted to MusicXML, and saving keeps the original as `.bak`.
3. **Add the music.** Open **Sync → Attach audio file…**, or drag an MP3 onto the window. The file is copied to
   `library/<song>/audio.mp3`, so it works offline from then on. You can also just copy the file into the folder.
4. **Match tab and audio** in the **Sync** panel:
   1. Play the recording and pause on the first beat of bar 1, then click **Bar 1 = audio position**.
      Use the ±0.01 s nudge buttons to fine-tune it.
   2. Press **Tap** (or `K`) on the downbeat every 2–4 bars while the song plays. Each tap pins that bar
      to the recording, so the cursor follows a band that speeds up or slows down.
      A couple of taps at the start and the end are often enough.
   3. Turn on **Sound → Tab synth** together with the recording to hear whether they line up.
   4. Click **Save sync to file**. This writes `fretline.json` next to the score. The score file itself is never touched.

Audio files are git-ignored, so your MP3s stay on your PC.

## Keyboard

`Space` play/pause · `Home` back to start · `←/→` previous/next bar · `/` search · `C` count-in ·
`M` metronome · `-`/`+` speed · `L` clear loop · `T` next instrument · `S` sync panel · `K` tap · `F` follow

## Project layout

```
server.js               local server (library API, audio streaming with Range support)
public/js/music.js      shared music helpers + buildSong() (score -> playable song)
public/js/importers/    MusicXML + Guitar Pro 3–8 readers, MusicXML writer (zip/xml readers included)
public/js/timeline.js   repeat expansion, timing, audio↔tab sync mapping
public/js/engine.js     playback: audio clock, synth, metronome, count-in, loop
public/js/renderer.js   SVG tab rendering, cursor, click-to-seek, drag-to-loop
public/js/ks.js         plucked-string / drum synthesis
public/js/ascii.js      ASCII tab -> score
tools/                  validate.js, convert.js, render-wav.js, selftest.js
tests/fixtures/         importer test files (made from the example songs)
docs/                   AI conversion prompt (MusicXML cheat sheet)
library/                your songs (one folder each)
```

Run the tests with `npm test`. The importer tests load every file in `tests/fixtures/` and check that each note
matches the example song in the library. The GP3–5 fixtures were written by PyGuitarPro, and the MusicXML ones by music21.

Without the server, you can still open `public/index.html` and use **Search → Open local files…**
to pick a score file, its audio and its `fretline.json`. In that mode, saving downloads the file instead of writing it to the library.
