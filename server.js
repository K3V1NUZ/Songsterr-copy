#!/usr/bin/env node
// Fretline local server — zero dependencies, runs fully offline.
//   node server.js [--port 4173] [--library ./library]
//
// Library layout (one folder per song):
//   library/<song>/song.musicxml   the score: MusicXML (.musicxml .xml .mxl) or Guitar Pro (.gp3-5 .gpx .gp)
//   library/<song>/audio.mp3       your recording (optional)
//   library/<song>/fretline.json   audio sync settings written by the app: {audio, offset, sync}
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScore, isScoreFile } from './public/js/importers/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const PORT = +(arg('--port', process.env.PORT || 4173));
const LIB = path.resolve(arg('--library', process.env.FRETLINE_LIBRARY || path.join(__dirname, 'library')));
const PUB = path.join(__dirname, 'public');
const SETTINGS = 'fretline.json';
const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.opus', '.webm'];
const SCORE_PRIORITY = ['.musicxml', '.xml', '.mxl', '.gp', '.gpx', '.gp5', '.gp4', '.gp3'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.musicxml': 'application/vnd.recordare.musicxml+xml', '.xml': 'application/xml', '.mxl': 'application/vnd.recordare.musicxml',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.flac': 'audio/flac', '.opus': 'audio/ogg', '.webm': 'audio/webm',
};

fs.mkdirSync(LIB, { recursive: true });

const safeId = (id) => /^[a-z0-9][a-z0-9._-]*$/i.test(id) && !id.includes('..');
const safeName = (n) => path.basename(n).replace(/[^\w.() -]+/g, '_').slice(0, 120);
const slugify = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'song';
const ext = (f) => path.extname(f).toLowerCase();

async function findScore(dir) {
  const files = (await fsp.readdir(dir)).filter((f) => isScoreFile(f) && !f.startsWith('.'));
  files.sort((a, b) => (a.startsWith('song.') ? -1 : 0) - (b.startsWith('song.') ? -1 : 0) || SCORE_PRIORITY.indexOf(ext(a)) - SCORE_PRIORITY.indexOf(ext(b)));
  return files[0] || null;
}
async function readSettings(dir) {
  try { return JSON.parse(await fsp.readFile(path.join(dir, SETTINGS), 'utf8')); } catch { return {}; }
}
async function writeSettings(dir, s) { await fsp.writeFile(path.join(dir, SETTINGS), JSON.stringify(s, null, 2) + '\n'); }

const cache = new Map(); // id -> {mtime, summary}
async function songInfo(id) {
  const dir = path.join(LIB, id);
  const file = await findScore(dir);
  if (!file) return null;
  const st = await fsp.stat(path.join(dir, file));
  let summary = cache.get(id);
  if (!summary || summary.mtime !== st.mtimeMs || summary.file !== file) {
    const r = await loadScore(file, await fsp.readFile(path.join(dir, file)));
    summary = { mtime: st.mtimeMs, file, title: r.song?.meta.title || file, artist: r.song?.meta.artist || '', format: r.format || '?',
      errors: r.errors.length, tracks: (r.song?.tracks || []).map((t) => ({ name: t.name, instrument: t.instrument })) };
    cache.set(id, summary);
  }
  const settings = await readSettings(dir);
  const files = await fsp.readdir(dir);
  const audio = settings.audio && files.includes(settings.audio) ? settings.audio
    : settings.audio ? null : files.find((f) => AUDIO_EXT.includes(ext(f))) || null;
  const url = (f) => `/library/${encodeURIComponent(id)}/${encodeURIComponent(f)}`;
  return { id, ...summary, mtime: undefined, fileUrl: url(file), editable: /\.(musicxml|xml)$/i.test(file),
    audio: audio ? url(audio) : null, audioName: audio, audioMissing: settings.audio && !audio ? settings.audio : null, settings };
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
    const type = MIME[ext(file)] || 'application/octet-stream';
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
  if (parts.length === 1 && req.method === 'GET') {
    const ids = (await fsp.readdir(LIB, { withFileTypes: true })).filter((d) => d.isDirectory() && safeId(d.name)).map((d) => d.name);
    const list = (await Promise.all(ids.map((id) => songInfo(id).catch(() => null)))).filter(Boolean)
      .sort((a, b) => (a.artist + a.title).localeCompare(b.artist + b.title));
    return send(res, 200, list);
  }
  // POST /api/songs?name=file.gp5  (raw score bytes) -> new song folder
  if (parts.length === 1 && req.method === 'POST') {
    const name = safeName(url.searchParams.get('name') || 'song.musicxml');
    if (!isScoreFile(name)) return send(res, 400, { error: 'Not a MusicXML or Guitar Pro file name' });
    const bytes = await readBody(req, 50 * 1024 * 1024);
    const r = await loadScore(name, bytes);
    if (!r.song) return send(res, 400, { error: r.errors[0]?.msg || 'Could not read the score' });
    const base = slugify(`${r.song.meta.artist ? r.song.meta.artist + ' ' : ''}${r.song.meta.title}`);
    let id = base, n = 2;
    while (fs.existsSync(path.join(LIB, id))) id = `${base}-${n++}`;
    await fsp.mkdir(path.join(LIB, id), { recursive: true });
    await fsp.writeFile(path.join(LIB, id, /\.(musicxml|xml)$/i.test(name) ? 'song.musicxml' : name), bytes);
    await writeSettings(path.join(LIB, id), {});
    return send(res, 201, await songInfo(id));
  }
  const id = decodeURIComponent(parts[1] || '');
  if (!safeId(id)) return send(res, 400, { error: 'bad id' });
  const dir = path.join(LIB, id);
  if (!fs.existsSync(dir)) return send(res, 404, { error: 'no such song' });
  if (parts.length === 2 && req.method === 'GET') return send(res, 200, await songInfo(id));
  // PUT /api/songs/:id/score?name=song.musicxml  -> save score (previous version kept as .bak)
  if (parts[2] === 'score' && req.method === 'PUT') {
    const name = safeName(url.searchParams.get('name') || 'song.musicxml');
    if (!isScoreFile(name)) return send(res, 400, { error: 'Not a MusicXML or Guitar Pro file name' });
    const bytes = await readBody(req, 50 * 1024 * 1024);
    const old = await findScore(dir);
    if (old) await fsp.rename(path.join(dir, old), path.join(dir, old + '.bak'));
    await fsp.writeFile(path.join(dir, name), bytes);
    return send(res, 200, await songInfo(id));
  }
  // PUT /api/songs/:id/settings  {offset, sync, ...}
  if (parts[2] === 'settings' && req.method === 'PUT') {
    const incoming = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8'));
    await writeSettings(dir, { ...(await readSettings(dir)), ...incoming });
    return send(res, 200, await songInfo(id));
  }
  // PUT /api/songs/:id/audio?name=song.mp3  (raw bytes)
  if (parts[2] === 'audio' && req.method === 'PUT') {
    const e = ext(url.searchParams.get('name') || 'audio.mp3');
    if (!AUDIO_EXT.includes(e)) return send(res, 400, { error: `unsupported audio type ${e}` });
    await fsp.writeFile(path.join(dir, 'audio' + e), await readBody(req));
    await writeSettings(dir, { ...(await readSettings(dir)), audio: 'audio' + e });
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
