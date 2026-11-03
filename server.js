#!/usr/bin/env node
// Fretline local server — zero dependencies, runs fully offline.
//   node server.js [--port 4173] [--library ./library]
// Serves the app, lists/saves songs in the library folder and streams your
// audio files (with HTTP Range support so seeking in MP3s works).
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTabDown, setHeaderLine } from './public/js/tabdown.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const PORT = +(arg('--port', process.env.PORT || 4173));
const LIB = path.resolve(arg('--library', process.env.FRETLINE_LIBRARY || path.join(__dirname, 'library')));
const PUB = path.join(__dirname, 'public');
const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.opus', '.webm'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.tabd': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.flac': 'audio/flac', '.opus': 'audio/ogg', '.webm': 'audio/webm',
};

fs.mkdirSync(LIB, { recursive: true });

const safeId = (id) => /^[a-z0-9][a-z0-9._-]*$/i.test(id) && !id.includes('..');
const slugify = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'song';

async function findTabFile(dir) {
  const files = await fsp.readdir(dir);
  const tabd = files.filter((f) => f.endsWith('.tabd')).sort();
  return tabd.includes('song.tabd') ? 'song.tabd' : tabd[0];
}
async function songInfo(id) {
  const dir = path.join(LIB, id);
  const file = await findTabFile(dir);
  if (!file) return null;
  const text = await fsp.readFile(path.join(dir, file), 'utf8');
  const { song, errors } = parseTabDown(text);
  const files = await fsp.readdir(dir);
  const audio = resolveAudio(song.meta.audio, files);
  const st = await fsp.stat(path.join(dir, file));
  return {
    id, file, text, title: song.meta.title, artist: song.meta.artist || '', errors: errors.length,
    tracks: song.tracks.map((t) => ({ name: t.name, instrument: t.instrument })),
    audio: audio ? `/library/${encodeURIComponent(id)}/${encodeURIComponent(audio)}` : null,
    audioName: audio, audioDeclared: song.meta.audio || null, modified: st.mtimeMs,
  };
}
function resolveAudio(declared, files) {
  if (declared && files.includes(declared)) return declared;
  if (declared) return null; // declared but missing -> app falls back to synth and tells you
  return files.find((f) => AUDIO_EXT.includes(path.extname(f).toLowerCase())) || null;
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = (req, limit = 600 * 1024 * 1024) => new Promise((resolve, reject) => {
  const chunks = []; let size = 0;
  req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'not found' });
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m[1] ? +m[1] : 0, end = m[2] ? +m[2] : st.size - 1;
      if (!m[1] && m[2]) { start = st.size - +m[2]; end = st.size - 1; }
      if (start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    }
  });
}

async function api(req, res, parts, url) {
  // GET /api/songs
  if (parts.length === 1 && req.method === 'GET') {
    const ids = (await fsp.readdir(LIB, { withFileTypes: true })).filter((d) => d.isDirectory() && safeId(d.name)).map((d) => d.name);
    const list = (await Promise.all(ids.map((id) => songInfo(id).catch(() => null)))).filter(Boolean)
      .map(({ text, ...rest }) => rest)
      .sort((a, b) => (a.artist + a.title).localeCompare(b.artist + b.title));
    return send(res, 200, list);
  }
  // POST /api/songs  {text, id?}  -> create new song folder
  if (parts.length === 1 && req.method === 'POST') {
    const { text, id: wanted } = JSON.parse((await readBody(req)).toString('utf8'));
    const { song, errors } = parseTabDown(text || '');
    if (errors.length && !song.tracks.length) return send(res, 400, { error: 'Could not parse file', errors });
    let id = wanted && safeId(wanted) ? wanted : slugify(`${song.meta.artist ? song.meta.artist + ' ' : ''}${song.meta.title}`);
    let n = 2; const base = id;
    while (fs.existsSync(path.join(LIB, id))) id = `${base}-${n++}`;
    await fsp.mkdir(path.join(LIB, id), { recursive: true });
    await fsp.writeFile(path.join(LIB, id, 'song.tabd'), text, 'utf8');
    return send(res, 201, await songInfo(id));
  }
  const id = decodeURIComponent(parts[1] || '');
  if (!safeId(id)) return send(res, 400, { error: 'bad id' });
  const dir = path.join(LIB, id);
  if (!fs.existsSync(dir)) return send(res, 404, { error: 'no such song' });
  // GET /api/songs/:id
  if (parts.length === 2 && req.method === 'GET') return send(res, 200, await songInfo(id));
  // PUT /api/songs/:id  (raw TabDown text) -> save, keeping a .bak of the previous version
  if (parts.length === 2 && req.method === 'PUT') {
    const text = (await readBody(req, 20 * 1024 * 1024)).toString('utf8');
    const file = (await findTabFile(dir)) || 'song.tabd';
    const p = path.join(dir, file);
    if (fs.existsSync(p)) await fsp.copyFile(p, p + '.bak');
    await fsp.writeFile(p, text, 'utf8');
    return send(res, 200, await songInfo(id));
  }
  // PUT /api/songs/:id/audio?name=song.mp3  (raw bytes) -> store audio, set "audio:" header
  if (parts.length === 3 && parts[2] === 'audio' && req.method === 'PUT') {
    let name = path.basename(url.searchParams.get('name') || 'audio.mp3');
    const ext = path.extname(name).toLowerCase();
    if (!AUDIO_EXT.includes(ext)) return send(res, 400, { error: `unsupported audio type ${ext}` });
    name = 'audio' + ext;
    await fsp.writeFile(path.join(dir, name), await readBody(req));
    const file = (await findTabFile(dir)) || 'song.tabd';
    const p = path.join(dir, file);
    const text = await fsp.readFile(p, 'utf8');
    await fsp.writeFile(p, setHeaderLine(text, 'audio', name), 'utf8');
    return send(res, 200, await songInfo(id));
  }
  return send(res, 404, { error: 'unknown endpoint' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);
    if (p.startsWith('/api/')) return await api(req, res, p.slice(5).split('/').filter(Boolean).map(encodeURIComponent), url);
    if (p.startsWith('/library/')) {
      const file = path.resolve(LIB, '.' + p.slice('/library'.length));
      if (!file.startsWith(LIB + path.sep)) return send(res, 403, { error: 'forbidden' });
      return serveFile(req, res, file);
    }
    if (p.startsWith('/docs/')) {
      const file = path.resolve(__dirname, '.' + p);
      if (!file.startsWith(path.join(__dirname, 'docs') + path.sep)) return send(res, 403, { error: 'forbidden' });
      return serveFile(req, res, file);
    }
    const file = path.resolve(PUB, '.' + (p === '/' ? '/index.html' : p));
    if (!file.startsWith(PUB + path.sep)) return send(res, 403, { error: 'forbidden' });
    return serveFile(req, res, file);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: String(e.message || e) });
  }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Fretline is running:  http://localhost:${PORT}\n  Library folder:       ${LIB}\n`);
});
