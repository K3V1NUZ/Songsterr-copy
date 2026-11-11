# Sync engine: BPM detection and score-to-audio sync

Design document for the tab player's auto-sync and manual sync.

- **Goal:** given a MusicXML score and an MP3, work out the exact second where every beat of the score is heard in the audio.
- **Constraints:** runs fully in the browser (desktop and phones), needs no analysis server, keeps manual sync working offline, and uses no AGPL code.
- **Approach:** a custom onset detector and beat tracker in TypeScript that uses the tempo we already know from the score or the user as a strong hint.

---

## 1. The big picture

```
 MP3 file ──► decode ──► onset curve ──► beat tracker ──► detected beats ─┐
                                              ▲                           │
 MusicXML ──► score beats + tempo map ────────┴──────────► align ◄────────┘
                                                              │
                                                              ▼
                                                  anchors [{scoreBeat, time}]
                                                              │
                         ┌────────────────────────────────────┼─────────────────┐
                         ▼                                    ▼                 ▼
                     timeMap  ◄── manual sync lanes      IndexedDB  ──►  Supabase (when online)
                         │
                         ▼
                 player cursor, looping, metronome, count-in
```

The **anchor list** is the only output that matters. Everything before it is a way to produce it automatically, and everything after it only reads it.
- Auto-sync **writes** anchors.
- Manual sync **edits** anchors.
- The player **reads** anchors through `timeMap`.

Because the player and the manual lanes depend only on anchors, they work without any detection code. That's why manual sync can work offline from day one.

---

## 2. Folder structure

```
src/sync/
├── types.ts          shared data shapes
├── timeMap.ts        score position <-> seconds (interpolation)
├── scoreBeats.ts     MusicXML -> list of beats in playback order + tempo map
├── decode.ts         MP3 -> mono Float32Array at 22050 Hz   (main thread)
├── fft.ts            FFT (own implementation or a wrapper around fft.js)
├── onset.ts          audio -> onset strength curve
├── tempo.ts          refines the BPM hint, checks for double or half tempo
├── beatTracker.ts    onset curve + tempo -> detected beat times
├── align.ts          score beats + detected beats -> anchors
├── sync.worker.ts    runs onset -> tempo -> beatTracker -> align off the UI thread
├── storage.ts        IndexedDB + Supabase push queue
└── __tests__/        Vitest tests with synthetic click tracks
```

---

## 3. Data model (`types.ts`)

```ts
/** One point where the score and the audio are pinned together. */
export interface Anchor {
  scoreBeat: number;   // absolute beat index in playback order (0 = first beat of bar 1)
  time: number;        // seconds in the audio file
  source: 'auto' | 'manual';
  confidence: number;  // 0..1, how sure the detector is (manual = 1)
}

export interface SyncData {
  songId: string;
  anchors: Anchor[];      // always sorted by scoreBeat
  globalOffset: number;   // seconds, applied to all anchors (fixes MP3 decoder delay etc.)
  algoVersion: number;    // bump when the algorithm changes, so old results can be redone
  updatedAt: number;      // ms timestamp, used for "newest edit wins"
  dirty: boolean;         // true = not pushed to Supabase yet
}

/** One beat of the score, after repeats are unrolled. */
export interface ScoreBeat {
  index: number;          // = scoreBeat in Anchor
  bar: number;            // 1-based bar number as written in the score
  beatInBar: number;      // 1-based
  isDownbeat: boolean;
  expectedBpm: number;    // tempo written in the score at this point
}
```

**Why `scoreBeat` is a single number instead of `{bar, beat}`:** interpolation and searching become plain number math. `bar` and `beatInBar` are kept in `ScoreBeat` only for display.

---

## 4. Score side (`scoreBeats.ts`)

Before touching the audio, turn the MusicXML into a flat list of beats **in the order they are played**.

1. **Unroll repeats and voltas** (`<repeat>`, `<ending>`, D.S./D.C. if you support them). The audio plays the chorus twice, so the beat list must contain it twice. This is the most common source of "sync is right for a while, then totally wrong."
2. **Pickup bar:** a measure with `implicit="yes"` is shorter than the time signature. Only count the beats it really has.
3. **Beats per bar** come from `<time><beats>`.
   - In simple meters (4/4, 3/4), one beat = one quarter note.
   - In compound meters (6/8, 12/8), treat the dotted quarter as the beat, so 6/8 has 2 beats per bar. That matches how drummers play it and how the beat tracker will hear it.
4. **Tempo map:** read `<sound tempo="...">` and `<metronome>` marks. Every beat gets an `expectedBpm`. If the score has no tempo, use the BPM the user entered.

The output is something like 400–800 `ScoreBeat`s for a normal song.

---

## 5. Audio side

### 5.1 Decode (`decode.ts`, main thread)

`decodeAudioData` doesn't exist inside Web Workers, so decoding happens on the main thread:

1. `AudioContext.decodeAudioData(arrayBuffer)` gives the full-quality audio.
2. Average the channels into mono.
3. Resample to **22050 Hz** with an `OfflineAudioContext(1, length, 22050)`. That's half the data with no loss for rhythm.
4. Send the `Float32Array` to the worker as a **transferable**, so it's moved without copying.

A 4-minute song becomes about 5.3 million samples (about 21 MB). That's fine even on phones.

**iOS note:** create the `AudioContext` inside the upload click handler, because Safari blocks audio contexts not started by a user gesture.

### 5.2 Onset strength curve (`onset.ts`)

**Goal:** a curve that is high wherever something new starts (a drum hit, a picked chord) and low during sustained sound.

**Method: spectral flux**

| Parameter   | Value                 | Meaning                              |
|-------------|-----------------------|--------------------------------------|
| frame size  | 1024 samples (46 ms)  | how much audio each FFT looks at     |
| hop size    | 256 samples (11.6 ms) | step between frames                  |
| frame rate  | 22050 / 256 ≈ 86 fps  | resolution of the curve              |
| window      | Hann                  | removes the hard edges of each frame |

For each frame:

1. Multiply the samples by a Hann window.
2. Run the FFT and take the magnitude of each frequency bin, `|X[k]|`.
3. **Log-compress:** `L[k] = log(1 + 100 · |X[k]|)`. This stops loud bass notes from drowning out the hi-hats.
4. **Flux:** `flux[n] = Σ_k max(0, L_n[k] − L_{n−1}[k])`. Only *increases* in energy count, because notes starting matter and notes fading don't.

Then clean up the whole curve:

5. Subtract a moving average (about 0.5 s window) and clip negatives to 0. This removes slow loudness changes like a quiet verse versus a loud chorus.
6. Normalize so the standard deviation is 1. That keeps the beat tracker's tightness parameter meaningful across quiet and loud songs.

**Example:** in a song with a kick on 1 and 3 and a snare on 2 and 4, the curve shows a tall spike every ~0.5 s at 120 BPM, with smaller spikes from hi-hats in between.

**Cost:** about 20,000 FFTs of size 1024 for a 4-minute song. That's under a second on a laptop and a few seconds on a phone.

### 5.3 Tempo refinement (`tempo.ts`)

The user's BPM or the score's tempo might be slightly off (120 written, 118.5 played), or the band might feel the beat at a different level. So:

1. Convert the hint to a **period in frames**: `P = 60 · fps / bpm` (120 BPM → about 43 frames).
2. Compute the **autocorrelation** of the onset curve for lags within ±8% of `P`. Autocorrelation asks: if I shift the curve by this many frames, how well does it line up with itself?
3. The lag with the highest score is the refined period.
4. **Double/half check:** also measure the autocorrelation at `P/2` and `2P`. If one of them is clearly stronger (for example, 1.5× higher), warn the user in the UI ("Detected ~240 BPM, did you mean 120?") and stay with the score's value. The score is the source of truth for counting; the audio only refines it.

For songs with written tempo changes, do this per tempo section, using the tempo map from §4.

### 5.4 Beat tracker (`beatTracker.ts`)

This is the core. It's a **dynamic programming** beat tracker (after Ellis, 2007).

**The idea:** we want a chain of beat times that
- lands on high points of the onset curve, and
- keeps the gaps between beats close to the expected period `P`.

Those two goals conflict sometimes (a missing kick drum, a syncopated accent), and dynamic programming finds the best trade-off over the **whole song** at once, instead of making greedy beat-by-beat decisions.

**Score for "the last beat is at frame t":**

```
C(t) = O(t) + max over τ in [t − 2P, t − P/2] of  ( C(τ) − α · (log((t − τ) / P))² )
```

- `O(t)`: onset strength at frame `t` (reward for landing on a hit).
- `(log((t − τ)/P))²`: penalty for a gap that isn't `P`. A log ratio is used so that "10% too fast" and "10% too slow" cost the same.
- `α` (**tightness**): how strongly to enforce a steady tempo. Start at **100**. Lower it (30–60) for live or loose recordings, raise it for click-tracked studio songs.
- For every `t`, also store `prev[t]`, the `τ` that gave the max. That's the backpointer.

**Extracting the beats:**

1. Compute `C(t)` and `prev[t]` for all frames, left to right.
2. Find the best `C(t)` within the last `P` frames of the song. That's the final beat.
3. Follow `prev[]` backward to the start. That chain is the beat sequence.
4. **Sub-frame refinement:** frames are 11.6 ms apart. For each beat, fit a parabola through the onset values at frames `t−1, t, t+1` and take its peak. That gives roughly 2–3 ms precision.

**Small worked example** (P = 4 frames, α = 100):

```
frame:   0  1  2  3  4  5  6  7  8  9 10 11 12
O(t):    5  0  0  1  4  0  0  0  0  1  0  0  6
```

The tracker can choose between a beat at 8 (onset 0, gap exactly 4) and a beat at 9 (onset 1, gap 5 from frame 4). The penalty for gap 5 is `100 · log(5/4)² ≈ 5`, which is bigger than the +1 onset gain, so it picks 8 and keeps the steady pulse through the quiet spot. The result is beats at 0, 4, 8, 12. This is exactly how it "plays through" bars where the drummer stops.

**Cost:** about 20,000 frames × about 60 candidate `τ` = 1.2 million operations. That's instant.

**Tempo changes:**
- **Gradual drift** (live band speeding up): handled automatically, because a 2% gap change costs almost nothing.
- **Written tempo changes:** use a per-frame expected period `P(t)` from the tempo map instead of a single `P`. Before the alignment exists we don't know which frame belongs to which bar, so first use the score's ideal timeline (bar positions computed from the written tempos) as a rough estimate.
- **Unwritten sudden jumps:** the tracker will produce a stretch of low-confidence beats. Detect this (see §6.3) and flag it for manual fixing.

**Local BPM for display:** `bpm_i = 60 / median(beat[i+1..i+8] − beat[i..i+7])`. This is the "BPM check at multiple points in the song" you asked about, and it falls straight out of the beat list.

---

## 6. Alignment (`align.ts`)

We now have:
- `scoreBeats`: what *should* be played (for example, 512 beats)
- `detectedBeats`: when beats *were heard* (for example, 520 timestamps, including some from the intro or count-in)

### 6.1 Find the first downbeat

The audio often starts with silence, noise, or a drum count-in, so detected beat 0 is not necessarily score beat 0.

1. Take the candidate starting beats: every detected beat in the first ~20 s.
2. For each candidate `k`, assume `detectedBeats[k]` = score beat 0 and score the fit:
   - the sum of onset strength at the **note onsets** in the first 8 bars (note positions from the MusicXML, placed between the assumed beats), plus
   - a bonus for strong onsets on **downbeats**, since downbeats are usually accented.
3. The highest-scoring `k` wins.
4. If the best score isn't clearly better than the runner-up (less than 10% ahead), mark the start as low confidence so the UI asks the user to check it.

### 6.2 Match the remaining beats

Walk both lists from the start point:

- If the next detected gap ≈ `P`: pair them one to one.
- If the gap ≈ `2P`: the tracker **missed a beat**, so insert an interpolated time in between.
- If the gap ≈ `P/2`: there's an **extra beat**, so skip it.
- If score beats run out first, the remaining detected beats are the outro or noise, so ignore them.
- If detected beats run out first, extrapolate the last score beats using the last local tempo and give them low confidence.

The result is one anchor per score beat.

### 6.3 Confidence

For each anchor: `confidence = clamp(O(beat) / median(O at all beats), 0, 1)`, and it's reduced further if the beat was inserted or extrapolated.

The UI can tint low-confidence bars (for example, yellow) so the user knows where to check the sync.

---

## 7. The time map (`timeMap.ts`)

This is the part the player uses 60 times per second, so it must be fast and simple.

```ts
secondsAt(scoreBeat: number): number   // where is this score position in the audio?
scoreBeatAt(seconds: number): number   // which score position is playing right now?
```

Both use **binary search** to find the two surrounding anchors, then **linear interpolation**:

```
Anchors: { scoreBeat: 16, time: 8.00 }, { scoreBeat: 17, time: 8.49 }

A note at scoreBeat 16.5 (an eighth note after beat 16):
time = 8.00 + (16.5 − 16) / (17 − 16) · (8.49 − 8.00) = 8.245 s
```

- Before the first anchor or after the last one, extrapolate using the tempo of the nearest pair.
- `globalOffset` is added at the end.
- **Note positions:** a note's `scoreBeat` comes from its MusicXML position (bar start + offset in divisions converted to beats). Compute it once when the score is loaded.
- **Looping, metronome and count-in** all reuse this: a metronome click is just `secondsAt(n)` for every integer `n`.

---

## 8. Manual sync

The two stacked lanes are a view of the anchors: the top lane shows bars from the score, and the bottom lane shows the waveform.

**Edit operations:**

| Gesture                   | Effect                                                                                                 |
|---------------------------|--------------------------------------------------------------------------------------------------------|
| Drag one bar line         | Move that bar's downbeat anchor. Anchors in between it and the neighboring locked anchors are stretched |
| Shift-drag (or a toggle)  | Move this anchor **and everything after it** by the same amount                                       |
| Global offset slider      | Shift the whole song (fixes MP3 delay or a consistently early or late feel)                            |
| Tap mode (optional)       | The user taps along during playback, and each tap becomes a manual anchor                              |

- Every manual edit sets `source: 'manual'`, `confidence: 1`.
- **Locked anchors survive re-analysis:** if auto-sync runs again (for example, after a new `algoVersion`), manual anchors act as fixed points, and the DP and alignment only fill in the beats between them.
- All of this is plain math on the anchor array plus a write to IndexedDB, so it works **fully offline**.

---

## 9. Worker protocol (`sync.worker.ts`)

```ts
// main -> worker
{ type: 'analyze', samples: Float32Array, sampleRate: 22050,
  scoreBeats: ScoreBeat[], lockedAnchors: Anchor[] }

// worker -> main
{ type: 'progress', stage: 'onset' | 'tempo' | 'beats' | 'align', pct: number }
{ type: 'warning', code: 'TEMPO_DOUBLE' | 'TEMPO_HALF' | 'LOW_CONFIDENCE_START', detail: string }
{ type: 'result', anchors: Anchor[], localBpm: number[] }
{ type: 'error', message: string }
```

Use Vite's worker import: `new Worker(new URL('./sync.worker.ts', import.meta.url), { type: 'module' })`. The service worker should cache the worker bundle too, so auto-sync also works offline.

---

## 10. Storage and offline (`storage.ts`)

**Local first:**
1. Save every result or edit to IndexedDB immediately with `dirty: true`. The tiny `idb` wrapper (ISC license) makes this easier.
2. When `navigator.onLine` is true (and on every `online` event), push dirty records to Supabase and set `dirty: false`.
3. **Conflicts:** when the same song was edited on two devices, compare `updatedAt` and keep the newest.

**Supabase table:**

```sql
create table song_sync (
  song_id      uuid primary key references songs(id) on delete cascade,
  anchors      jsonb   not null,
  global_offset real   not null default 0,
  algo_version int     not null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id)
);
```

Anchors are small: 600 beats × about 40 bytes ≈ 24 KB per song, so `jsonb` is fine.

---

## 11. Testing

1. **Synthetic click tracks (unit tests, Vitest):** generate audio in code, with a short noise burst every 0.5 s.
   - Steady 120 BPM: every detected beat must be within ±20 ms of the truth.
   - Ramp from 100 to 130 BPM: checks that drift is followed.
   - Clicks with every 7th beat missing: checks that the tracker plays through gaps.
   - 2 s of silence + a 4-click count-in: checks the first-downbeat search.
2. **Real songs:** pick 5–10 songs you know well (studio rock, a live recording, something quiet). Tap the beats in Sonic Visualiser and export them as the reference.
3. **Metric:** the beat-tracking F-measure with a ±70 ms tolerance (the standard MIREX evaluation). For each song, count the fraction of reference beats that have a detected beat within 70 ms. Track this number whenever you tune `α` or the onset parameters.

---

## 12. Known pitfalls

- **MP3 encoder delay:** MP3s carry about 20–50 ms of padding at the start, and browsers trim it differently. This is the main reason `globalOffset` exists.
- **Repeats not unrolled:** the sync slowly breaks after the first repeat sign. See §4.
- **Double or half tempo:** see §5.3. Always trust the score's beat count over the audio's.
- **Very quiet intros or rubato sections:** expect low confidence there and rely on manual anchors.
- **Phone memory:** don't keep the full-quality decoded `AudioBuffer` and the 22 kHz copy alive at the same time longer than needed.
- **Main thread:** never run `onset` or `beatTracker` on the main thread, or the UI freezes on phones.

---

## 13. Build order

| Step | Module(s)                     | Done when                                                   |
|------|-------------------------------|-------------------------------------------------------------|
| 1    | `types`, `timeMap`            | The cursor follows hand-written anchors                     |
| 2    | `scoreBeats`                  | A song with repeats gives the right number of beats         |
| 3    | Manual lanes + `storage`      | Manual sync works offline and survives a reload             |
| 4    | `decode`, `fft`, `onset`      | The onset curve plotted under the waveform shows clear spikes |
| 5    | `tempo`, `beatTracker`        | Click-track tests pass                                      |
| 6    | `align`                       | A real song syncs end to end                                |
| 7    | `sync.worker`, progress UI    | Analysis runs on a phone without freezing                   |
| 8    | Supabase push                 | Edits show up on a second device                            |

---

## Open decisions

- **FFT:** write your own radix-2 FFT (about 40 lines, good for learning) or use `fft.js` (MIT).
- **MusicXML parsing:** reuse the app's existing parser if it exposes measures, time signatures and repeats; otherwise write `scoreBeats.ts` on top of `DOMParser`.

## Reference

- D. P. W. Ellis, "Beat Tracking by Dynamic Programming", *Journal of New Music Research*, 2007. This is the algorithm in §5.4.

---

## Implementation status

All eight build steps are done.

| Step | Where |
|------|-------|
| 1 `types`, `timeMap` | `src/sync/types.ts`, `src/sync/timeMap.ts`. The player itself keeps using alphaTab sync points (`syncMap.ts`), derived from the anchors, one per beat. |
| 2 `scoreBeats` | `src/sync/scoreBeats.ts`; repeats come unrolled from alphaTab's play order (`timeline.ts`) |
| 3 Manual lanes + storage | `src/features/sync/SyncPanel.tsx` (edits anchors), `src/sync/anchors.ts` (the edit math), `src/features/sync/syncState.ts` (load/save) |
| 4 `decode`, `fft`, `onset` | `src/sync/decode.ts`, `fft.ts`, `onset.ts` |
| 5 `tempo`, `beatTracker` | `src/sync/tempo.ts`, `beatTracker.ts` |
| 6 `align` | `src/sync/align.ts` |
| 7 `sync.worker`, progress UI | `src/sync/sync.worker.ts`, `pipeline.ts`, `runAutoSync.ts` |
| 8 Supabase push | `src/sync/storage.ts`, `supabase/migrations/0001_song_sync.sql` |

How the pieces fit:
- **Anchors are the source of truth.** They are stored as `SyncData` in their own IndexedDB table (`sync`). The `Song` keeps the alphaTab sync points derived from them, plus the source and confidence for the library.
- **Older songs** (synced with sync points or tempo marks) are turned into anchors on first open. The bars that carried a sync point become pins when the old sync was made by hand.
- **The sync panel** has one toolbar. On the left: the sync buttons and the status. On the right: play/pause, Pin, "Move following bars", the Adjust menu, zoom, undo/redo and help (?). It wraps on phones. The panel is opened and closed with the sync button in the bottom bar.
  - **Sync all** (primary): a fresh auto-sync of the whole song that ignores pins. It removes every pin, after asking, and Undo brings them back.
  - **Sync from here**: enabled when the selected bar is pinned. The bars before it stay exactly as they are and the bar itself stays where it is. Everything after it is synced again from the audio, keeping the pins after it. It analyses only the audio from 2 s before that bar onward, with the bar passed in as a fixed point (`analyzeFrom` in `pipeline.ts`), so nothing earlier in the song (a wrong start, an intro) can pull the result off.
  - **Pin** pins the selected bar where it is (no drag needed); it reads "Pinned" when the bar already is. Click a bar line to select a bar; Delete unpins it.
  - **Help (?)** toggles a short "How to sync" window: above the panel on desktop, a larger window with a close button on phones. A click outside, or on the ? again, closes it.
  - Dragging a bar line pins it, and the bars up to the neighbouring pins stretch. On a side with no pin, the bars move along instead. Shift-drag, or "Move following bars", moves a bar and everything after it. Dragging empty space moves everything.
  - **Adjust** menu (closed by default): the global offset slider (±300 ms), "Move all bars" (−1 beat, −10 ms, +10 ms, +1 beat), "Tap the downbeats" (one pin per tap) and "Reset to last sync".
  - **Playback:** the panel's play/pause button. Drag the waveform to scroll, click it to choose where to play from.
  - Each auto-sync is one undo step.
- **Confidence:** bars with an anchor under 0.5 confidence are tinted, and the small "N to check · next" badge jumps between them. Each bar shows its tempo, and the tab shows a tempo label where the tempo changes by 3 % or more.
- **Server:** pushing is on when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set. Without them, sync stays on the device. The table's row-level-security policies allow signed-in users only, so pushing also needs accounts, which come in phase 5.

Differences from the plan above:
- `pipeline.ts` holds the whole analysis as one pure function, so the tests run it without a worker.
- §6.1 scores candidate starts over the whole song, not just 8 bars (the downbeat bonus still uses the first 8 bars). In a song with a note on every beat, only the end of the music tells a count-in from bar 1.
- Song confidence is the contrast between the onset strength where the anchors put the score's notes and the average onset strength (noise ≈ 2×, real matches ≥ 4×), mixed with the mean per-anchor confidence of §6.3.
- `SyncData.autoAnchors` keeps the last auto-sync result on the device, for "Reset to auto-sync". It is not pushed.
- `song_id` has no foreign key yet: songs don't live in Supabase yet.
- The old tempo-mark editor is gone. Its per-mark BPM field and per-mark bar length were replaced by anchors, which can follow any bar or beat timing directly.
