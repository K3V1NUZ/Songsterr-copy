// Extracts timed note events from an alphaTab score, in played order (repeats expanded).
import type { model } from '@coderline/alphatab';
import { TICKS_PER_QUARTER, type Timeline } from './timeline';

export interface NoteEvent {
  /** Absolute beat (quarter notes, played order). */
  beat: number;
  durBeats: number;
  /** MIDI pitch; undefined for percussion (onset only). */
  midi?: number;
}

export function scoreNoteEvents(score: model.Score, tl: Timeline): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const p of tl.played) {
    for (const track of score.tracks) {
      for (const staff of track.staves) {
        const bar = staff.bars[p.barIndex];
        if (!bar) continue;
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            if (beat.isRest) continue;
            const start = p.startBeat + beat.playbackStart / TICKS_PER_QUARTER;
            const durBeats = beat.playbackDuration / TICKS_PER_QUARTER;
            for (const note of beat.notes) {
              if (note.isTieDestination) continue; // held, no new attack
              if (staff.isPercussion || note.isPercussion) out.push({ beat: start, durBeats });
              else if (!note.isDead) out.push({ beat: start, durBeats, midi: note.realValue });
            }
          }
        }
      }
    }
  }
  return out.sort((a, b) => a.beat - b.beat);
}
