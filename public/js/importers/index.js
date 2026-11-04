// Entry point: detect the file type, parse it, build a playable song.
//   const { song, errors, warnings, model } = await loadScore('song.gp5', bytes)
import { isGPBinary, parseGPBinary, isGPX, gpxToGpif, gp7ToGpif, parseGPIF } from './guitarpro.js';
import { musicXmlBytesToText, isMusicXmlText, parseMusicXML } from './musicxml.js';
import { isZip, listZip } from './zip.js';
import { countNotes } from './model.js';
import { modelToMusicXML } from './musicxml-writer.js';
import { buildSong } from '../music.js';

export const SCORE_EXTENSIONS = ['.musicxml', '.xml', '.mxl', '.gp', '.gp3', '.gp4', '.gp5', '.gpx'];
export const isScoreFile = (name) => SCORE_EXTENSIONS.some((e) => name.toLowerCase().endsWith(e));
export const isTextScore = (name) => /\.(musicxml|xml)$/i.test(name);
export { modelToMusicXML, countNotes, buildSong };

export async function importScoreFile(name, bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  const ext = (name.match(/\.[^.]+$/)?.[0] || '').toLowerCase();
  let model;
  if (isGPBinary(bytes)) model = parseGPBinary(bytes);
  else if (isGPX(bytes)) model = parseGPIF(gpxToGpif(bytes), 'Guitar Pro 6');
  else if (isZip(bytes)) {
    const names = listZip(bytes).map((e) => e.name);
    if (names.some((n) => /score\.gpif$/i.test(n))) model = parseGPIF(await gp7ToGpif(bytes), 'Guitar Pro 7+');
    else model = parseMusicXML(await musicXmlBytesToText(bytes));
  } else {
    const text = new TextDecoder().decode(bytes.subarray(0, 4000));
    if (isMusicXmlText(text)) model = parseMusicXML(await musicXmlBytesToText(bytes));
    else if (/<GPIF/.test(text)) model = parseGPIF(new TextDecoder().decode(bytes));
    else throw new Error(`Unrecognised file${ext ? ' (' + ext + ')' : ''}. Supported: MusicXML (.musicxml .xml .mxl) and Guitar Pro 3–8 (.gp3 .gp4 .gp5 .gpx .gp)`);
  }
  model.fileName = name;
  model.tracks.forEach((t) => { t.noteCount = countNotes(t); });
  return model;
}

// parse + build in one go; never throws (fatal problems come back in errors)
export async function loadScore(name, bytes) {
  try {
    const model = await importScoreFile(name, bytes);
    const res = buildSong(model);
    return { ...res, model, format: model.format };
  } catch (e) {
    return { song: null, model: null, errors: [{ line: 0, msg: e.message }], warnings: [] };
  }
}
