// Entry point: detect the file type and return the import model.
//   const model = await importScoreFile('song.gp5', uint8array)
//   const { text, warnings } = modelToTabDown(model, { trackIndexes: [0, 2] })
import { isGPBinary, parseGPBinary, isGPX, gpxToGpif, gp7ToGpif, parseGPIF } from './guitarpro.js';
import { musicXmlBytesToText, isMusicXmlText, parseMusicXML } from './musicxml.js';
import { isZip, listZip } from './zip.js';
import { countNotes, modelToTabDown } from './model.js';

export const IMPORT_EXTENSIONS = ['.gp', '.gp3', '.gp4', '.gp5', '.gpx', '.musicxml', '.xml', '.mxl'];
export { modelToTabDown, countNotes };

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
    else throw new Error(`Unrecognised file${ext ? ' (' + ext + ')' : ''}. Supported: Guitar Pro 3–8 (.gp3 .gp4 .gp5 .gpx .gp) and MusicXML (.musicxml .xml .mxl)`);
  }
  model.fileName = name;
  model.tracks.forEach((t) => { t.noteCount = countNotes(t); });
  return model;
}
