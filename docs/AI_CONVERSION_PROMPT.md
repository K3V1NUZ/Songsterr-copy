Convert the guitar tab I give you into a **MusicXML 4.0** file with tablature. I'll give you
a link to the tab, screenshots of it, or the tab as text. It's for my private, offline practice
library, which plays the file in sync with my own recording.

If you can't open the link or read the notes reliably, don't guess. Tell me and ask for screenshots
(one per instrument, covering the whole song) instead.

## Output

Reply with **one** fenced code block containing the complete `.musicxml` file, then a short list of
anything you were unsure about. Don't shorten it with "…" or "repeat as above". Write every bar.

## Rules

1. **Structure.** Use `score-partwise`, with one `<part>` per instrument (all guitars and bass unless
   I say otherwise; include drums only if I ask). Every part has the same number of measures.
2. **Use `<divisions>24</divisions>`** (24 per quarter note). Durations:

   | note | `<type>` | `<duration>` | | note | `<type>` | `<duration>` |
   |---|---|---|---|---|---|---|
   | whole | `whole` | 96 | | dotted half | `half` + `<dot/>` | 72 |
   | half | `half` | 48 | | dotted quarter | `quarter` + `<dot/>` | 36 |
   | quarter | `quarter` | 24 | | dotted eighth | `eighth` + `<dot/>` | 18 |
   | eighth | `eighth` | 12 | | eighth triplet | `eighth` + time-modification 3/2 | 8 |
   | 16th | `16th` | 6 | | 16th triplet | `16th` + time-modification 3/2 | 4 |
   | 32nd | `32nd` | 3 | | quarter triplet | `quarter` + time-modification 3/2 | 16 |

   **The durations in each measure must add up exactly** to beats × 96 / beat-type
   (4/4 = 96, 3/4 = 72, 6/8 = 72, 2/4 = 48). Fill gaps with `<rest/>` notes. A bar with nothing
   in it is `<note><rest measure="yes"/><duration>96</duration></note>`.
3. **Tablature.** In measure 1's `<attributes>`, write `<clef><sign>TAB</sign><line>5</line></clef>` and
   `<staff-details>` with `<staff-lines>` and one `<staff-tuning>` per string. **Line 1 is the LOWEST
   string.** Add `<capo>` if there is one.
4. **Every note** has `<notations><technical><string>S</string><fret>F</fret></technical></notations>`.
   **String 1 is the HIGHEST string** (high e). Also add `<pitch>`, the sounding pitch of that string
   and fret. With standard tuning the open strings are E2 A2 D3 G3 B3 E4 (strings 6 → 1), and a bass is E1 A1 D2 G2.
5. **Chords:** the 2nd, 3rd, … notes of a chord start with `<chord/>` and have the same duration.
6. **Techniques:**
   - hammer-on/pull-off: `<hammer-on type="start">H</hammer-on>` on the first note and `<hammer-on type="stop"/>` on the next (inside `<technical>`). Same for `<pull-off>`.
   - slide: `<slide type="start"/>` and then `<slide type="stop"/>` (inside `<notations>`).
   - bend: `<bend><bend-alter>2</bend-alter></bend>` in `<technical>`. 2 = full, 1 = half.
   - vibrato: `<ornaments><wavy-line type="start"/></ornaments>`.
   - palm mute: `<play><mute>palm</mute></play>` as the last child of `<note>`.
   - dead note: `<notehead>x</notehead>`. Ghost note: `<notehead parentheses="yes">normal</notehead>`.
   - natural harmonic: `<harmonic><natural/></harmonic>` in `<technical>`. Accent: `<articulations><accent/></articulations>`.
   - tie: `<tie type="start"/>` after `<duration>` on the first note and `<tie type="stop"/>` on the second,
     plus `<tied type="start"/>` / `<tied type="stop"/>` in `<notations>`.
7. **Tempo, sections, repeats.** In the first part only, write tempo as
   `<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>`
   and section names as `<direction><direction-type><rehearsal>Chorus</rehearsal></direction-type></direction>`.
   Repeats are `<barline location="left"><repeat direction="forward"/></barline>` and
   `<barline location="right"><repeat direction="backward" times="2"/></barline>`, in every part.
   Alternate endings use `<ending number="1" type="start"/>` and `type="stop"`/`"discontinue"`.
8. Set the title in `<work><work-title>` and the artist in `<identification><creator type="composer">`.
   Use `<midi-program>` in `<score-part>`: 26 acoustic, 28 clean electric, 31 distortion, 34 bass.

Before answering, count every measure. If you can run code, check the file with
`node tools/validate.js song.musicxml` from the Fretline folder and fix everything it reports.

## Template (a 2-bar example: one guitar in standard tuning)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work><work-title>Example Riff</work-title></work>
  <identification><creator type="composer">Someone</creator></identification>
  <part-list>
    <score-part id="P1"><part-name>Lead Guitar</part-name>
      <midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>31</midi-program></midi-instrument>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>24</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>TAB</sign><line>5</line></clef>
        <staff-details>
          <staff-lines>6</staff-lines>
          <staff-tuning line="1"><tuning-step>E</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
          <staff-tuning line="2"><tuning-step>A</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
          <staff-tuning line="3"><tuning-step>D</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
          <staff-tuning line="4"><tuning-step>G</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
          <staff-tuning line="5"><tuning-step>B</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
          <staff-tuning line="6"><tuning-step>E</tuning-step><tuning-octave>4</tuning-octave></staff-tuning>
        </staff-details>
      </attributes>
      <direction><direction-type><rehearsal>Intro</rehearsal></direction-type></direction>
      <direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>100</per-minute></metronome></direction-type><sound tempo="100"/></direction>
      <!-- palm-muted low E, eighth -->
      <note><pitch><step>E</step><octave>2</octave></pitch><duration>12</duration><type>eighth</type>
        <notations><technical><string>6</string><fret>0</fret></technical></notations><play><mute>palm</mute></play></note>
      <note><pitch><step>E</step><octave>2</octave></pitch><duration>12</duration><type>eighth</type>
        <notations><technical><string>6</string><fret>0</fret></technical></notations><play><mute>palm</mute></play></note>
      <!-- hammer-on 5 -> 7 on the G string, two eighths -->
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>12</duration><type>eighth</type>
        <notations><technical><hammer-on type="start">H</hammer-on><string>3</string><fret>5</fret></technical></notations></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>12</duration><type>eighth</type>
        <notations><technical><hammer-on type="stop"/><string>3</string><fret>7</fret></technical></notations></note>
      <!-- E5 power chord, half note -->
      <note><pitch><step>E</step><octave>2</octave></pitch><duration>48</duration><type>half</type>
        <notations><technical><string>6</string><fret>0</fret></technical></notations></note>
      <note><chord/><pitch><step>B</step><octave>2</octave></pitch><duration>48</duration><type>half</type>
        <notations><technical><string>5</string><fret>2</fret></technical></notations></note>
    </measure>
    <measure number="2">
      <!-- full bend on the B string with vibrato, dotted half + quarter rest -->
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>72</duration><type>half</type><dot/>
        <notations><ornaments><wavy-line type="start"/></ornaments><technical><bend><bend-alter>2</bend-alter></bend><string>2</string><fret>10</fret></technical></notations></note>
      <note><rest/><duration>24</duration><type>quarter</type></note>
      <barline location="right"><bar-style>light-heavy</bar-style></barline>
    </measure>
  </part>
</score-partwise>
```
