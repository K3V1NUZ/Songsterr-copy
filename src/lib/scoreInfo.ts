// Detects a score's format and reads its metadata (title, artist, tempo, parts) with alphaTab.
import { importer, Settings, type model } from '@coderline/alphatab';
import type { Part, ScoreFormat } from '@/data/types';
import { newId } from '@/data/SongRepository';

export function detectScoreFormat(name: string, bytes: Uint8Array): ScoreFormat {
  const head = String.fromCharCode(...bytes.subarray(0, 32));
  const gp = /FICHIER GUITAR PRO v([345])/.exec(head);
  if (gp) return `gp${gp[1]}` as ScoreFormat;
  if (head.startsWith('BCFZ') || head.startsWith('BCFS')) return 'gpx';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return /\.mxl$/i.test(name) ? 'mxl' : 'gp';
  return 'musicxml';
}

export function loadScore(bytes: Uint8Array): model.Score {
  return importer.ScoreLoader.loadScoreFromBytes(bytes, new Settings());
}

const NOTE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function tuningName(track: model.Track): string | undefined {
  const staff = track.staves[0];
  if (!staff || staff.isPercussion || !staff.tuning.length) return undefined;
  if (staff.tuningName) return staff.tuningName;
  // alphaTab lists tunings high -> low
  return [...staff.tuning].reverse().map((m) => NOTE[m % 12]).join(' ');
}

export function instrumentName(track: model.Track): string {
  const staff = track.staves[0];
  if (staff?.isPercussion) return 'drums';
  const program = track.playbackInfo.program;
  if (program >= 32 && program <= 39) return 'bass';
  if (program >= 24 && program <= 31) return 'guitar';
  if (/vocal|voice|vox/i.test(track.name)) return 'vocals';
  if (program >= 0 && program <= 7) return 'keys';
  return staff?.tuning.length ? 'guitar' : 'other';
}

export interface ScoreInfo {
  title: string;
  artist: string;
  tempo: number;
  parts: Part[];
  tuning?: string;
}

export function scoreInfo(score: model.Score): ScoreInfo {
  const parts = score.tracks.map<Part>((t, i) => {
    const tuning = tuningName(t);
    return { id: newId(), name: t.name || `Track ${i + 1}`, instrument: instrumentName(t), trackIndex: i, ...(tuning ? { tuning } : {}) };
  });
  const firstGuitar = parts.find((p) => p.instrument === 'guitar');
  return {
    title: score.title || 'Untitled',
    artist: score.artist || '',
    tempo: score.tempo || 120,
    parts,
    ...(firstGuitar?.tuning ? { tuning: firstGuitar.tuning } : {}),
  };
}
