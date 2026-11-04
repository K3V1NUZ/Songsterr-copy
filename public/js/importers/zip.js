// Tiny ZIP reader (for .gp Guitar Pro 7/8 files and .mxl compressed MusicXML).
// Uses the built-in DecompressionStream (browsers and Node 18+), no dependencies.

export function isZip(bytes) { return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04; }

export function listZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // find End Of Central Directory record
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid ZIP file (no central directory)');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = [];
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt ZIP central directory');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    entries.push({ name, method, csize, usize, local });
    p += 46 + nlen + xlen + clen;
  }
  return entries;
}

export async function readZipEntry(bytes, entry) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lp = entry.local;
  const start = lp + 30 + dv.getUint16(lp + 26, true) + dv.getUint16(lp + 28, true);
  const raw = bytes.subarray(start, start + entry.csize);
  if (entry.method === 0) return raw.slice();
  if (entry.method !== 8) throw new Error(`Unsupported ZIP compression method ${entry.method}`);
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function readZipFile(bytes, predicate) {
  const entries = listZip(bytes);
  const e = entries.find(typeof predicate === 'string' ? (x) => x.name === predicate : predicate);
  return e ? { name: e.name, data: await readZipEntry(bytes, e), entries } : { entries };
}
