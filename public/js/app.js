import { parseTabDown, setHeaderLine, formatSync } from './tabdown.js';
import { playedAt } from './timeline.js';
import { TabView } from './renderer.js';
import { Engine } from './engine.js';
import { asciiToTabDown } from './ascii.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const engine = new Engine();
const view = new TabView($('#tab'), $('#score'));

const ICONS = {
  guitar: '<svg viewBox="0 0 24 24"><path d="M19.6 2.6l1.8 1.8-2.1 2.1-.6-.1-4.4 4.4c.9 1.6.7 3.4-.4 4.5-.8.8-2 .9-3 .6-.3 1.3-.9 2.5-1.9 3.5-2 2-4.9 2.3-6.2 1-1.3-1.3-1-4.2 1-6.2 1-1 2.2-1.6 3.5-1.9-.3-1-.2-2.2.6-3 1.1-1.1 2.9-1.3 4.5-.4l4.4-4.4-.1-.6zM7.5 13.3a1.3 1.3 0 1 0 1.9 1.8 1.3 1.3 0 0 0-1.9-1.8z"/></svg>',
  bass: '<svg viewBox="0 0 24 24"><path d="M20.5 1.5l2 2-3 2.2-4.3 4.3c1 1.9.6 3.6-.6 4.8-.6.6-1.5.9-2.4.9-.1 1.6-.8 3.2-2 4.4-2.1 2.1-5.1 2.4-6.5 1-1.4-1.4-1.1-4.4 1-6.5 1.2-1.2 2.8-1.9 4.4-2 0-.9.3-1.8.9-2.4 1.2-1.2 2.9-1.6 4.8-.6l4.3-4.3z"/></svg>',
  drums: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="9" rx="9" ry="3.5"/><path d="M3 9v6c0 1.9 4 3.5 9 3.5s9-1.6 9-3.5V9c0 1.9-4 3.5-9 3.5S3 10.9 3 9z" opacity=".7"/><path d="M4 2l7 6M20 2l-7 6" stroke="currentColor" stroke-width="1.6"/></svg>',
  keys: '<svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2" opacity=".35"/><path d="M5 5h2v9H5zM10 5h2v9h-2zM15 5h2v9h-2z"/></svg>',
};
const iconFor = (inst) => ICONS[inst === 'bass' ? 'bass' : inst === 'drums' ? 'drums' : inst === 'keys' ? 'keys' : 'guitar'];

const state = {
  songs: [], current: null, // {id, text, audio, file, local?}
  song: null, trackIndex: 0, serverless: false, issues: { errors: [], warnings: [] },
  tap: null,
};

// ---------------------------------------------------------------- helpers
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms);
}
const fmtTime = (s) => { s = Math.max(0, s); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function openModal(id) { $$('.modal.open').forEach((m) => m.classList.remove('open')); $(id).classList.add('open'); closePopovers(); }
function closeModals() { $$('.modal.open').forEach((m) => m.classList.remove('open')); }
$$('.modal').forEach((m) => m.addEventListener('pointerdown', (e) => { if (e.target === m) closeModals(); }));
$$('[data-close]').forEach((b) => b.addEventListener('click', closeModals));

async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

// ---------------------------------------------------------------- library
async function refreshLibrary() {
  try { state.songs = await api('/api/songs'); state.serverless = false; }
  catch { state.serverless = true; state.songs = state.songs.filter((s) => s.local); }
  renderResults();
}
function renderResults() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const list = state.songs.filter((s) => {
    const hay = `${s.title} ${s.artist} ${s.tracks.map((t) => t.name + ' ' + t.instrument).join(' ')}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const ul = $('#results');
  if (!list.length) {
    ul.innerHTML = `<li class="none">${state.serverless
      ? 'Server not running — use “Open local files…” or start it with <code>npm start</code>'
      : q ? 'No matching songs in your library' : 'Library is empty — import a song'}</li>`;
    return;
  }
  ul.innerHTML = list.map((s, i) => `<li data-id="${esc(s.id)}" class="${i === 0 ? 'sel' : ''}">
      <span class="inst-icon">${iconFor(s.tracks[0]?.instrument)}</span>
      <span><span class="t">${esc(s.title)}</span> <span class="a">— ${esc(s.artist || 'Unknown')}</span></span>
      <span class="ins">${s.errors ? '<span class="badge err">errors</span>' : ''}
        ${s.audio ? '<span class="badge audio">♪ audio</span>' : '<span class="badge">synth only</span>'}
        <span class="badge">${s.tracks.length} track${s.tracks.length === 1 ? '' : 's'}</span></span></li>`).join('');
  ul.querySelectorAll('li[data-id]').forEach((li) => li.addEventListener('click', () => { closeModals(); loadSong(li.dataset.id); }));
}
$('#openSearch').addEventListener('click', () => { openModal('#searchModal'); $('#searchInput').select(); $('#searchInput').focus(); refreshLibrary(); });
$('#searchInput').addEventListener('input', renderResults);
$('#searchInput').addEventListener('keydown', (e) => {
  const items = $$('#results li[data-id]');
  let i = items.findIndex((li) => li.classList.contains('sel'));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    items[i]?.classList.remove('sel');
    i = Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    items[i]?.classList.add('sel'); items[i]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && items[i]) { closeModals(); loadSong(items[i].dataset.id); }
});

// open local files without the server (.tabd + audio picked together)
$('#localFiles').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  const tab = files.find((f) => /\.(tabd|txt)$/i.test(f.name));
  const audio = files.find((f) => f.type.startsWith('audio/'));
  if (!tab) return toast('Pick a .tabd file (and optionally its audio file at the same time)');
  const text = await tab.text();
  const id = 'local:' + tab.name;
  const entry = { id, local: true, text, audio: audio ? URL.createObjectURL(audio) : null, title: tab.name, artist: '', tracks: [] };
  state.songs = state.songs.filter((s) => s.id !== id).concat(entry);
  closeModals();
  loadSong(id);
});

async function loadSong(id) {
  let info = state.songs.find((s) => s.id === id && s.local);
  if (!info) {
    try { info = await api(`/api/songs/${encodeURIComponent(id)}`); }
    catch (e) { return toast('Could not load song: ' + e.message); }
  }
  state.current = info;
  try { localStorage.setItem('fretline:last', id); } catch { /* storage unavailable */ }
  applyText(info.text, { audio: info.audio, keepTrack: false });
}

// parse + render; audio === undefined keeps the currently loaded audio
function applyText(text, { audio, keepTrack = true } = {}) {
  const { song, errors, warnings } = parseTabDown(text);
  state.issues = { errors, warnings };
  state.song = song;
  state.current.text = text;
  const pos = engine.scoreTime ? engine._pos : 0;
  const audioUrl = audio === undefined ? (engine.hasAudio ? engine.audio.src : null) : audio;
  if (audio === undefined && engine.hasAudio) {
    // keep audio element, swap song data
    engine.pause();
    const src = engine.audio.src;
    engine.load(song, null); engine.hasAudio = true; engine.audio.src = src;
  } else {
    engine.load(song, audioUrl);
    // fresh load: play the recording if there is one, otherwise the tab synth
    engine.opts.synth = !audioUrl; $('#optSynth').checked = engine.opts.synth;
    engine.opts.useAudio = true; $('#optAudio').checked = true;
  }
  if (!keepTrack || state.trackIndex >= song.tracks.length) state.trackIndex = 0;
  if (keepTrack) engine._pos = Math.min(pos, engine.tl.duration);
  $('#empty').style.display = 'none';
  $('#songLabel').textContent = `${song.meta.title}${song.meta.artist ? ' — ' + song.meta.artist : ''}`;
  document.title = `${song.meta.title} · Fretline`;
  renderHead();
  renderTrack();
  updateSoundUI();
  updateSyncUI();
  if (errors.length) toast(`${errors.length} error(s) in this file — click the warning under the title`);
}

function renderHead() {
  const m = state.song.meta, { errors, warnings } = state.issues;
  const n = errors.length + warnings.length;
  const audioNote = state.current.audio ? '♪ recording attached' :
    m.audio ? `♪ “${esc(m.audio)}” not found — playing synth` : 'synth only — attach audio in Sync';
  $('#songHead').innerHTML = `<h1>${esc(m.title)}</h1><span class="artist">${esc(m.artist)}</span>
    <span class="meta">${m.tempo} BPM · ${m.time[0]}/${m.time[1]}${m.key ? ' · ' + esc(m.key) : ''} · ${state.song.tracks.length} tracks · ${audioNote}</span>
    ${n ? `<span class="warn" id="issuesLink">${errors.length ? errors.length + ' errors' : ''} ${warnings.length ? warnings.length + ' warnings' : ''}</span>` : ''}`;
  $('#issuesLink')?.addEventListener('click', openEditor);
}

function renderTrack() {
  const t = state.song.tracks[state.trackIndex];
  view.render(state.song, state.trackIndex);
  $('#trackLabel').textContent = t.name;
  $('#trackIcon').innerHTML = iconFor(t.instrument);
  renderTrackPopover();
  if (engine.loop) highlightLoop();
  updateCursor(true);
}

// ---------------------------------------------------------------- tracks
function renderTrackPopover() {
  const pop = $('#popTrack');
  pop.innerHTML = state.song.tracks.map((t, i) => {
    const ts = engine.trackState[i];
    const tun = t.instrument === 'drums' ? 'drum kit' : `${t.tuning.length} strings${t.capo ? ', capo ' + t.capo : ''}`;
    return `<div class="track-item ${i === state.trackIndex ? 'on' : ''}" data-i="${i}">
      <span class="inst-icon">${iconFor(t.instrument)}</span>
      <span class="nm">${esc(t.name)}<small>${esc(t.instrument)} · ${tun}</small></span>
      <button class="solo ${ts.solo ? 'on' : ''}" data-solo="${i}" title="Solo">S</button>
      <button class="mute ${ts.mute ? 'on' : ''}" data-mute="${i}" title="Mute">M</button></div>`;
  }).join('');
  pop.querySelectorAll('.track-item').forEach((d) => d.addEventListener('click', (e) => {
    const i = +d.dataset.i;
    if (e.target.dataset.solo) { engine.trackState[i].solo = !engine.trackState[i].solo; renderTrackPopover(); return; }
    if (e.target.dataset.mute) { engine.trackState[i].mute = !engine.trackState[i].mute; renderTrackPopover(); return; }
    state.trackIndex = i; renderTrack(); closePopovers();
  }));
}

// ---------------------------------------------------------------- popovers
function closePopovers() { $$('.popover.open').forEach((p) => p.classList.remove('open')); }
function togglePopover(pop, btn) {
  const open = pop.classList.contains('open');
  closePopovers();
  if (open) return;
  pop.classList.add('open');
  const r = btn.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left + r.width / 2 - pop.offsetWidth / 2)) + 'px';
}
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.popover') && !e.target.closest('.ctl')) closePopovers();
});
$('#btnTrack').addEventListener('click', (e) => { if (state.song) togglePopover($('#popTrack'), e.currentTarget); });
$('#btnSpeed').addEventListener('click', (e) => togglePopover($('#popSpeed'), e.currentTarget));
$('#btnSound').addEventListener('click', (e) => togglePopover($('#popSound'), e.currentTarget));

// speed
const SPEEDS = [25, 50, 60, 70, 75, 80, 90, 100, 110, 125, 150];
$('#popSpeed .speed-presets').innerHTML = SPEEDS.filter((s) => s !== 110 && s !== 60 && s !== 150).map((s) => `<button data-s="${s}">${s}%</button>`).join('');
$$('#popSpeed [data-s]').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.s)));
$('#speedRange').addEventListener('input', (e) => setSpeed(+e.target.value));
function setSpeed(pct) {
  pct = Math.max(25, Math.min(150, pct));
  engine.setSpeed(pct / 100);
  $('#speedLabel').textContent = pct + '%';
  $('#speedRange').value = pct;
  $$('#popSpeed [data-s]').forEach((b) => b.classList.toggle('on', +b.dataset.s === pct));
  $('#btnSpeed').classList.toggle('on', pct !== 100);
}

// sound
$('#optAudio').addEventListener('change', (e) => { const p = engine.scoreTime(); const was = engine.playing; engine.pause(); engine.opts.useAudio = e.target.checked; engine._pos = p; if (was) engine.play(); updateSoundUI(); });
$('#optSynth').addEventListener('change', (e) => { engine.opts.synth = e.target.checked; updateSoundUI(); });
$('#volAudio').addEventListener('input', (e) => engine.setAudioVolume(+e.target.value));
$('#volSynth').addEventListener('input', (e) => engine.setSynthVolume(+e.target.value));
function updateSoundUI() {
  const has = engine.hasAudio;
  $('#optAudio').disabled = !has;
  const a = engine.audioMode, s = engine.opts.synth;
  $('#soundLabel').textContent = a && s ? 'Audio+Tab' : a ? 'Recording' : s ? 'Synth' : 'Muted';
  $('#soundHint').textContent = has
    ? 'Tip: turn on both to hear the tab synth on top of the recording — the easiest way to check the sync.'
    : 'No recording attached to this song. Use Sync → “Attach audio file…”, or put audio.mp3 next to song.tabd.';
}

// toggles
function bindToggle(btn, key, after) {
  const b = $(btn);
  b.classList.toggle('on', !!engine.opts[key]);
  b.addEventListener('click', () => { engine.opts[key] = !engine.opts[key]; b.classList.toggle('on', engine.opts[key]); after?.(); savePrefs(); });
}
bindToggle('#btnCountIn', 'countIn');
bindToggle('#btnMetro', 'metronome');
$('#btnFollow').addEventListener('click', () => { view.follow = !view.follow; $('#btnFollow').classList.toggle('on', view.follow); });
$('#btnZoomIn').addEventListener('click', () => zoom(0.1));
$('#btnZoomOut').addEventListener('click', () => zoom(-0.1));
function zoom(d) { view.zoom = Math.max(0.7, Math.min(1.8, Math.round((view.zoom + d) * 10) / 10)); if (state.song) renderTrack(); savePrefs(); }
function savePrefs() {
  try { localStorage.setItem('fretline:prefs', JSON.stringify({ countIn: engine.opts.countIn, metronome: engine.opts.metronome, zoom: view.zoom })); } catch { /* ignore */ }
}
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('fretline:prefs') || '{}');
    if (p.countIn != null) engine.opts.countIn = p.countIn;
    if (p.metronome != null) engine.opts.metronome = p.metronome;
    if (p.zoom) view.zoom = p.zoom;
  } catch { /* ignore */ }
  $('#btnCountIn').classList.toggle('on', engine.opts.countIn);
  $('#btnMetro').classList.toggle('on', engine.opts.metronome);
}

// ---------------------------------------------------------------- transport
$('#btnPlay').addEventListener('click', () => { if (state.song) engine.toggle(); });
$('#btnStop').addEventListener('click', () => { engine.stop(); updateCursor(true); view.scrollToRow(view.barLayout?.[engine.tl.played[playedAt(engine.tl, engine._pos)]?.barIndex]?.row ?? 0); });
engine.on('state', () => {
  const playing = engine.playing || engine.countingIn;
  $('#playIcon').innerHTML = playing ? '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>' : '<path d="M7 4.5v15l13-7.5z"/>';
  $('#btnLoop').classList.toggle('on', !!engine.loop);
});
engine.on('countin', (i, n) => {
  const c = $('#countin');
  if (!i) { c.classList.remove('on'); return; }
  c.textContent = i; c.classList.remove('on'); void c.offsetWidth; c.classList.add('on');
  clearTimeout(c._t); c._t = setTimeout(() => c.classList.remove('on'), i === n ? 350 : 900);
});
engine.on('seek', () => updateCursor(true));
engine.on('error', (e) => toast('Audio error: ' + e.message));
engine.on('audioready', () => updateSyncUI());

function currentPlayed() {
  const t = engine.scoreTime();
  const k = playedAt(engine.tl, Math.min(t, engine.tl.duration - 1e-6));
  return { t, k, pb: engine.tl.played[k] };
}
function updateCursor(force) {
  if (!state.song || !engine.tl?.played.length) return;
  const { t, k, pb } = currentPlayed();
  const q = (t - pb.start) / pb.spq;
  view.setCursor(pb.barIndex, Math.max(0, q), engine.playing);
  if (force && !engine.playing) view.ensureVisible(pb.barIndex);
  const total = engine.tl.played.length;
  const audioT = engine.audioMode ? ` · ♪ ${fmtTime(engine.audio.currentTime)}` : '';
  $('#pos').innerHTML = `Bar ${pb.barIndex + 1}${total !== state.song.masterBars.length ? ` <small>(${k + 1}/${total})</small>` : `/${total}`}<br>${fmtTime(t)} / ${fmtTime(engine.tl.duration)}${audioT}`;
}
(function frame() { if (engine.playing) updateCursor(); requestAnimationFrame(frame); })();

// click to seek, drag to loop
view.on('seek', (bar, q, shift) => {
  if (shift && engine.loop) {
    const a = state.loopBars[0];
    return setLoopBars(Math.min(a, bar), Math.max(a, bar));
  }
  const k = nearestPlayed(bar);
  const pb = engine.tl.played[k];
  engine.seek(pb.start + q * pb.spq);
  updateCursor(true);
});
view.on('loop', (a, b) => setLoopBars(a, b));
function nearestPlayed(bar, after) {
  const cur = after ?? currentPlayed().k;
  let best = -1, bestD = Infinity;
  engine.tl.played.forEach((p, k) => {
    if (p.barIndex !== bar) return;
    const d = after != null ? (k >= after ? k - after : 1e6 + k) : Math.abs(k - cur);
    if (d < bestD) { bestD = d; best = k; }
  });
  return Math.max(0, best);
}
function setLoopBars(a, b) {
  const ka = nearestPlayed(a), kb = nearestPlayed(b, ka);
  const pa = engine.tl.played[ka], pz = engine.tl.played[kb];
  state.loopBars = [a, b];
  engine.setLoop(pa.start, pz.end);
  highlightLoop();
  const t = engine.scoreTime();
  if (t < pa.start || t >= pz.end) engine.seek(pa.start);
  toast(`Looping bars ${a + 1}–${b + 1}  (L or Loop button to clear)`);
}
function highlightLoop() { if (state.loopBars) view.setLoopBars(...state.loopBars); }
$('#btnLoop').addEventListener('click', () => {
  if (engine.loop) { engine.setLoop(null); state.loopBars = null; view.setLoopBars(null); }
  else if (state.song) {
    const { pb } = currentPlayed();
    setLoopBars(pb.barIndex, Math.min(state.song.masterBars.length - 1, pb.barIndex + 3));
  }
});

// ---------------------------------------------------------------- keyboard
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select')) { if (e.key === 'Escape') { e.target.blur(); closeModals(); } return; }
  if (e.key === 'Escape') { closeModals(); closePopovers(); $('#syncPanel').classList.remove('open'); return; }
  if ($('.modal.open')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (e.key === '/') { e.preventDefault(); $('#openSearch').click(); return; }
  if (!state.song) return;
  if (e.key === ' ') { e.preventDefault(); engine.toggle(); }
  else if (e.key === 'Home') { e.preventDefault(); $('#btnStop').click(); }
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const { k: kk } = currentPlayed();
    const p = engine.tl.played[Math.max(0, Math.min(engine.tl.played.length - 1, kk + (e.key === 'ArrowRight' ? 1 : -1)))];
    engine.seek(p.start); updateCursor(true);
  }
  else if (k === 'c') $('#btnCountIn').click();
  else if (k === 'm') $('#btnMetro').click();
  else if (k === 'l') { if (engine.loop) $('#btnLoop').click(); }
  else if (k === 'f') $('#btnFollow').click();
  else if (k === 's') toggleSync();
  else if (k === 't') { state.trackIndex = (state.trackIndex + 1) % state.song.tracks.length; renderTrack(); toast(state.song.tracks[state.trackIndex].name); }
  else if (k === 'k') { if ($('#syncPanel').classList.contains('open')) tap(); }
  else if (e.key === '-' || e.key === '_') setSpeed(Math.round(engine.speed * 100) - 5);
  else if (e.key === '+' || e.key === '=') setSpeed(Math.round(engine.speed * 100) + 5);
});

// ---------------------------------------------------------------- sync panel
function toggleSync() { $('#syncPanel').classList.toggle('open'); updateSyncUI(); }
$('#btnSync').addEventListener('click', () => { if (state.song) toggleSync(); });
$('#syncClose').addEventListener('click', () => $('#syncPanel').classList.remove('open'));

function updateSyncUI() {
  if (!state.song) return;
  const m = state.song.meta;
  const has = engine.hasAudio;
  $('#syncNoAudio').innerHTML = has ? '' : `<p>No audio attached${m.audio ? ` (file “${esc(m.audio)}” is missing)` : ''}. Attach your MP3 below — it is copied into this song's folder so it works offline.</p>`;
  $('#offsetVal').textContent = (m.sync.length ? (m.sync.find((a) => a.bar === 1)?.time ?? engine.sync.toAudio(0)) : m.offset).toFixed(3) + ' s';
  const anchors = m.sync.slice().sort((a, b) => a.bar - b.bar);
  $('#anchorList').innerHTML = anchors.length
    ? anchors.map((a, i) => `<span>bar ${a.bar} @ ${a.time.toFixed(2)}s<button data-del="${a.bar}" title="Remove">×</button></span>`).join('')
    : '<span class="hint" style="background:none">none — only the offset is used (audio must match the tab tempo)</span>';
  $$('#anchorList [data-del]').forEach((b) => b.addEventListener('click', () => {
    m.sync = m.sync.filter((a) => a.bar !== +b.dataset.del); syncChanged();
  }));
  // effective tempo of the recording vs the tab
  const pts = engine.sync.points;
  if (pts.length >= 2) {
    const ratio = (pts[pts.length - 1].s - pts[0].s) / (pts[pts.length - 1].a - pts[0].a);
    $('#tempoInfo').textContent = `recording runs at ${(ratio * 100).toFixed(1)}% of tab tempo (≈ ${(m.tempo * ratio).toFixed(1)} BPM)`;
  } else $('#tempoInfo').textContent = '';
  if (state.tap) $('#tapInfo').textContent = `next tap → bar ${state.tap.next}`;
  else $('#tapInfo').textContent = '';
}
function syncChanged() {
  engine.updateSync();
  updateSyncUI();
  updateCursor(true);
  state.syncDirty = true;
}
function shiftAll(d) {
  const m = state.song.meta;
  if (m.sync.length) m.sync.forEach((a) => (a.time = Math.round((a.time + d) * 1000) / 1000));
  else m.offset = Math.round((m.offset + d) * 1000) / 1000;
  syncChanged();
}
$$('[data-nudge]').forEach((b) => b.addEventListener('click', () => shiftAll(+b.dataset.nudge)));
$('#btnSetOffset').addEventListener('click', () => {
  if (!engine.hasAudio) return toast('Attach an audio file first');
  const m = state.song.meta, now = engine.audio.currentTime;
  if (m.sync.length) {
    m.sync = m.sync.filter((a) => a.bar !== 1);
    m.sync.push({ bar: 1, time: now });
  } else m.offset = Math.round(now * 1000) / 1000;
  syncChanged();
  toast(`Bar 1 now starts at ${now.toFixed(3)} s in the recording`);
});
$('#btnAnchorHere').addEventListener('click', () => {
  if (!engine.hasAudio) return toast('Attach an audio file first');
  const { k } = currentPlayed();
  addAnchor(k + 1, engine.audio.currentTime);
  toast(`Bar ${k + 1} pinned to ${engine.audio.currentTime.toFixed(2)} s`);
});
function addAnchor(bar, time) {
  const m = state.song.meta;
  m.sync = m.sync.filter((a) => a.bar !== bar);
  if (!m.sync.length && bar !== 1) m.sync.push({ bar: 1, time: m.offset }); // keep the existing offset as anchor
  m.sync.push({ bar, time: Math.round(time * 1000) / 1000 });
  // drop anchors that would make time run backwards
  m.sync.sort((a, b) => a.bar - b.bar);
  m.sync = m.sync.filter((a) => (a.bar < bar ? a.time < time : a.bar > bar ? a.time > time : true));
  syncChanged();
}
$('#btnTap').addEventListener('click', tap);
function tap() {
  if (!engine.hasAudio || !engine.opts.useAudio) return toast('Tapping needs the recording: attach audio and enable it under Sound');
  if (!engine.playing) {
    // first press starts playback a bit before the start bar
    const start = Math.max(1, +$('#tapStart').value || 1);
    state.tap = { next: start, every: +$('#tapEvery').value };
    const pb = engine.tl.played[start - 1];
    const lead = Math.max(0, engine.sync.toAudio(pb.start) - 3);
    engine.opts.countIn = false; $('#btnCountIn').classList.remove('on');
    engine.seek(engine.sync.toScore(lead));
    engine.play();
    toast(`Tap on the first beat of bar ${start}`);
    updateSyncUI();
    return;
  }
  if (!state.tap) state.tap = { next: currentPlayed().k + 1, every: +$('#tapEvery').value };
  const t = engine.audio.currentTime - (+$('#tapLatency').value || 0);
  addAnchor(state.tap.next, t);
  state.tap.next += state.tap.every;
  if (state.tap.next > engine.tl.played.length) { state.tap = null; toast('Reached the end — save the sync when happy'); }
  updateSyncUI();
}
engine.on('paused', () => { if (state.tap) { state.tap = null; updateSyncUI(); } });
$('#btnClearSync').addEventListener('click', () => { state.song.meta.sync = []; syncChanged(); });
$('#btnSyncSave').addEventListener('click', saveSync);
async function saveSync() {
  const m = state.song.meta;
  let text = state.current.text;
  text = setHeaderLine(text, 'offset', (m.sync.find((a) => a.bar === 1)?.time ?? m.offset).toFixed(3));
  text = setHeaderLine(text, 'sync', m.sync.length ? formatSync(m.sync) : null);
  await saveText(text);
  state.syncDirty = false;
}
$('#attachAudio').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (state.current.local || state.serverless) {
    state.current.audio = URL.createObjectURL(f);
    engine.load(state.song, state.current.audio); renderHead(); updateSoundUI(); updateSyncUI();
    return toast('Audio loaded for this session (start the server to store it in the library)');
  }
  toast('Copying audio into the library…', 10000);
  try {
    const info = await api(`/api/songs/${encodeURIComponent(state.current.id)}/audio?name=${encodeURIComponent(f.name)}`, { method: 'PUT', body: f });
    state.current = info;
    applyText(info.text, { audio: info.audio + '?v=' + Date.now(), keepTrack: true });
    toast('Audio attached. Now set where bar 1 starts, then tap a few bars.');
  } catch (err) { toast('Upload failed: ' + err.message); }
});

async function saveText(text) {
  if (state.current.local || state.serverless) { download(text); return; }
  try {
    const info = await api(`/api/songs/${encodeURIComponent(state.current.id)}`, { method: 'PUT', body: text });
    state.current.text = info.text;
    toast('Saved to ' + info.id + '/' + info.file);
    refreshLibrary();
  } catch (e) { toast('Save failed: ' + e.message); }
}
function download(text) {
  const a = document.createElement('a');
  const name = (state.song?.meta.title || 'song').replace(/[^\w-]+/g, '_') + '.tabd';
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = name; a.click();
  toast('Downloaded ' + name);
}

// ---------------------------------------------------------------- editor
function issuesHtml(errors, warnings) {
  if (!errors.length && !warnings.length) return '<div class="ok">✓ No problems found</div>';
  return errors.map((e) => `<div class="e" data-line="${e.line}">✗ line ${e.line}: ${esc(e.msg)}</div>`).join('') +
    warnings.map((w) => `<div class="w" data-line="${w.line}">! line ${w.line}: ${esc(w.msg)}</div>`).join('');
}
function bindIssueJump(container, ta) {
  container.querySelectorAll('[data-line]').forEach((d) => d.addEventListener('click', () => {
    const line = +d.dataset.line; if (!line) return;
    const lines = ta.value.split('\n');
    const start = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
    ta.focus(); ta.setSelectionRange(start, start + lines[line - 1].length);
    ta.scrollTop = (line - 5) * 19;
  }));
}
function liveValidate(ta, out) {
  const run = () => {
    const { errors, warnings } = parseTabDown(ta.value);
    out.innerHTML = issuesHtml(errors, warnings);
    bindIssueJump(out, ta);
  };
  ta.addEventListener('input', () => { clearTimeout(ta._t); ta._t = setTimeout(run, 250); });
  return run;
}
const validateEdit = liveValidate($('#editText'), $('#editIssues'));
function openEditor() {
  if (!state.song) return toast('Open a song first');
  $('#editText').value = state.current.text;
  openModal('#editModal');
  validateEdit();
}
$('#btnEdit').addEventListener('click', openEditor);
$('#btnEditApply').addEventListener('click', () => { applyText($('#editText').value, {}); toast('Preview updated (not saved yet)'); });
$('#btnEditDownload').addEventListener('click', () => download($('#editText').value));
$('#btnEditSave').addEventListener('click', async () => {
  const text = $('#editText').value;
  applyText(text, {});
  await saveText(text);
  closeModals();
});

// ---------------------------------------------------------------- import
const validateImport = liveValidate($('#importText'), $('#importIssues'));
function openImport() { openModal('#importModal'); validateImport(); loadAiPrompt(); }
$('#btnImport').addEventListener('click', openImport);
$('#btnImport2').addEventListener('click', openImport);
$('#btnHelp').addEventListener('click', () => openModal('#helpModal'));
$$('#importModal .tab').forEach((t) => t.addEventListener('click', () => showPane(t.dataset.pane)));
function showPane(id) {
  $$('#importModal .tab').forEach((x) => x.classList.toggle('on', x.dataset.pane === id));
  $$('#importModal .pane').forEach((p) => p.classList.toggle('on', p.id === id));
  $('#btnDoImport').style.display = id === 'paneTabd' ? '' : 'none';
}
$('#tabdFile').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  $('#importText').value = await f.text(); validateImport();
});
$('#btnAsciiConvert').addEventListener('click', () => {
  const time = ($('#asciiTime').value || '4/4').split('/').map(Number);
  const res = asciiToTabDown($('#asciiText').value, {
    title: $('#asciiTitle').value || 'Imported tab', artist: $('#asciiArtist').value, tempo: +$('#asciiTempo').value || 100, time,
  });
  if (res.error) return toast(res.error);
  $('#importText').value = res.text;
  showPane('paneTabd'); validateImport();
  toast(`Converted ${res.bars} bars — check the rhythm, then Import`);
});
let aiPromptLoaded = false;
async function loadAiPrompt() {
  if (aiPromptLoaded) return;
  try {
    const r = await fetch('/docs/AI_CONVERSION_PROMPT.md');
    if (r.ok) { $('#aiPrompt').value = await r.text(); aiPromptLoaded = true; }
  } catch { $('#aiPrompt').value = 'Open docs/AI_CONVERSION_PROMPT.md from the project folder.'; }
}
$('#btnCopyPrompt').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#aiPrompt').value); toast('Prompt copied — paste it to your AI with the tab link'); }
  catch { $('#aiPrompt').select(); toast('Press Ctrl+C to copy'); }
});
$('#btnDoImport').addEventListener('click', async () => {
  const text = $('#importText').value;
  const { song, errors } = parseTabDown(text);
  if (!song.tracks.length) return toast('Nothing to import');
  if (errors.length && !confirm(`${errors.length} error(s) — import anyway?`)) return;
  const audio = $('#importAudio').files[0];
  if (state.serverless) {
    const id = 'local:' + song.meta.title;
    state.songs.push({ id, local: true, text, audio: audio ? URL.createObjectURL(audio) : null, title: song.meta.title, artist: song.meta.artist, tracks: [] });
    closeModals(); return loadSong(id);
  }
  try {
    let info = await api('/api/songs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    if (audio) info = await api(`/api/songs/${encodeURIComponent(info.id)}/audio?name=${encodeURIComponent(audio.name)}`, { method: 'PUT', body: audio });
    closeModals();
    $('#importText').value = ''; $('#importAudio').value = '';
    await refreshLibrary();
    loadSong(info.id);
    toast(`Imported into library/${info.id}/`);
  } catch (e) { toast('Import failed: ' + e.message); }
});

// drag & drop a .tabd and/or audio file anywhere
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const files = [...e.dataTransfer.files];
  const tab = files.find((f) => /\.(tabd|txt)$/i.test(f.name));
  const audio = files.find((f) => f.type.startsWith('audio/'));
  if (tab) { $('#importText').value = await tab.text(); openImport(); showPane('paneTabd'); validateImport(); }
  else if (audio && state.song) {
    const dt = new DataTransfer(); dt.items.add(audio);
    $('#attachAudio').files = dt.files; $('#attachAudio').dispatchEvent(new Event('change'));
  }
});

window.addEventListener('beforeunload', (e) => { if (state.syncDirty) { e.preventDefault(); e.returnValue = ''; } });

// ---------------------------------------------------------------- boot
loadPrefs();
showPane('paneTabd');
(async () => {
  await refreshLibrary();
  let last = null;
  try { last = localStorage.getItem('fretline:last'); } catch { /* ignore */ }
  const pick = state.songs.find((s) => s.id === last) || state.songs[0];
  if (pick) loadSong(pick.id);
})();
window.fretline = { engine, view, state }; // handy for debugging in the console
