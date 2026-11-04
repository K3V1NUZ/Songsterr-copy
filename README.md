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
* Import **Guitar Pro** (GP3, GP4, GP5, GPX, GP7/8) and **MusicXML** files with exact rhythms and techniques. You can also convert ASCII tabs or let an AI convert a tab for you
* No accounts, no scraping, no internet needed

## Run it

You need [Node.js](https://nodejs.org) 18 or newer. It has no dependencies, so there's no `npm install`.

```bash
npm start
```

Then open http://localhost:4173. The songs live in `library/`, and each song gets its own folder.

The repo doesn't include an audio file. To try the audio sync with the Greensleeves example, generate a demo recording.
It has a 2-second intro gap and is 4% slower than the tab, like a real recording would be:

```bash
npm run demo-audio
```

## Add a song

The workflow:

1. **Get the tab into TabDown.** You have four options:
   * **Guitar Pro or MusicXML file (best).** Go to **Import → Guitar Pro / MusicXML**, or drop the file onto the window.
     Pick which instruments to keep and click **Convert**. Rhythms, ties, tunings, capo, repeats, alternate endings,
     tempo changes, sections, drums and techniques (hammer-ons, pull-offs, slides, bends, vibrato, palm mutes,
     harmonics, dead and ghost notes) all carry over. Sheet music without tab data gets playable string/fret positions automatically.
     The command-line version is `node tools/import.js song.gp5 --tracks 1,2 -o library/my-song/song.tabd`.
   * **AI.** In the app, go to **Import → Convert with AI**, copy the prompt, and give it to an AI together
     with the link to the tab you want. If the AI can't open the page, give it screenshots
     ([prompt file](docs/AI_CONVERSION_PROMPT.md)). The AI answers with a `.tabd` file.
   * **ASCII tab.** Go to **Import → Convert ASCII tab**. The notes come out exact, but the rhythm is estimated.
     The command-line version is `node tools/ascii2tabd.js tab.txt --title "…" --tempo 120 > song.tabd`.
   * **By hand.** The format is small. See [docs/TABDOWN_SPEC.md](docs/TABDOWN_SPEC.md).
2. **Import it.** Paste the file into **Import**, or drag a `.tabd` file onto the window. The editor checks it live:
   errors, and any bar that doesn't add up to its time signature.
   You can also check it from the command line with `node tools/validate.js song.tabd`.
3. **Add the music.** Open **Sync → Attach audio file…**, or drag an MP3 onto the window. The file is copied to
   `library/<song>/audio.mp3`, so it works offline from then on. You can also just copy the file into the folder
   and add `audio: audio.mp3` to the header.
4. **Match tab and audio** in the **Sync** panel:
   1. Play the recording and pause on the first beat of bar 1, then click **Bar 1 = audio position**.
      Use the ±0.01 s nudge buttons to fine-tune it.
   2. Press **Tap** (or `K`) on the downbeat every 2–4 bars while the song plays. Each tap pins that bar
      to the recording, so the cursor follows a band that speeds up or slows down.
      A couple of taps at the start and the end are often enough.
   3. Turn on **Sound → Tab synth** together with the recording to hear whether they line up.
   4. Click **Save sync to file**. This writes `offset:` and `sync:` into the `.tabd` file.

Audio files are git-ignored, so your MP3s stay on your PC.

## Keyboard

`Space` play/pause · `Home` back to start · `←/→` previous/next bar · `/` search · `C` count-in ·
`M` metronome · `-`/`+` speed · `L` clear loop · `T` next instrument · `S` sync panel · `K` tap · `F` follow

## Project layout

```
server.js               local server (library API, audio streaming with Range support)
public/js/tabdown.js    TabDown parser (shared by the browser and Node)
public/js/timeline.js   repeat expansion, timing, audio↔tab sync mapping
public/js/engine.js     playback: audio clock, synth, metronome, count-in, loop
public/js/renderer.js   SVG tab rendering, cursor, click-to-seek, drag-to-loop
public/js/ks.js         plucked-string / drum synthesis
public/js/ascii.js      ASCII-tab → TabDown converter
public/js/importers/    Guitar Pro 3–8 + MusicXML importers (zip/xml readers, TabDown writer)
tools/                  validate.js, import.js, ascii2tabd.js, render-wav.js, selftest.js
tests/fixtures/         importer test files (made from the example songs)
docs/                   format spec + AI conversion prompt
library/                your songs (one folder each)
```

Run the tests with `npm test`. The importer tests convert `tests/fixtures/` back to TabDown and check that every note
matches the original example song. The GP3–5 fixtures were written by PyGuitarPro, and the MusicXML ones by music21.

Without the server, you can still open `public/index.html` and use **Search → Open local files…**
to pick a `.tabd` file and an audio file. In that mode, saving downloads the file instead of writing it to the library.
