// Manual sync tool (docs/SYNC_ENGINE.md §8): two stacked lanes like a video-editor timeline, both a view
// of the anchors.
//   top    = recording waveform (drag to scroll, click to jump there)
//   bottom = the score's bars (drag a bar line onto its beat in the waveform)
// Dragging a bar line pins that bar (a manual anchor); the bars between it and the neighbouring pins
// stretch. Shift-drag (or "Move following") moves the bar and everything after it. The offset slider
// shifts the whole song a little; tapping pins one bar per tap. Auto-sync keeps the pins and only fills
// in the beats between them. Every change is previewed live in the tab and saved per song, offline too.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Slider } from '@/components/ui';
import type { Song } from '@/data/types';
import type { PlayerController } from '@/features/player/PlayerController';
import { usePlayer } from '@/features/player/playerStore';
import { fmtTime } from '@/features/player/BottomBar';
import { anchorsToPlayerPoints, barConfidence, barTempos, isLocked, moveAnchor, pinStart, shiftAll, shiftFrom, unpin } from '@/sync/anchors';
import { decodeForAnalysis, waveformPeaks, type Peaks } from '@/sync/decode';
import { runAutoSync } from '@/sync/runAutoSync';
import { ALGO_VERSION } from '@/sync/storage';
import type { Timeline } from '@/sync/timeline';
import type { Anchor, ScoreBeat } from '@/sync/types';
import { useSettings } from '@/store/settings';
import { useHistory } from './useHistory';
import { loadSync, saveSync, type SyncState } from './syncState';

interface Props {
  song: Song;
  controller: PlayerController;
  recording: Blob | null;
  onSongChange: (song: Song) => void;
  onClose: () => void;
  /** Start an auto-sync as soon as the panel opens. */
  autoRun?: boolean;
  /** Called after an auto-sync finished. */
  onAutoDone?: (confidence: number) => void;
}

const WAVE_H = 88;
const BARS_H = 64;
const TAP_LATENCY_MS = 60;
/** Bars with an anchor below this confidence are tinted: "check the sync here". */
const LOW_CONFIDENCE = 0.5;
const OFFSET_RANGE_MS = 300;

type Drag =
  | { kind: 'pan'; x0: number; view0: number; moved: boolean }
  | { kind: 'all'; x0: number; base: SyncState }
  | { kind: 'bar'; played: number; x0: number; base: SyncState; following: boolean; moved: boolean };

const EMPTY: SyncState = { anchors: [], globalOffset: 0 };
const fmtOffset = (s: number) => `${s >= 0 ? '+' : ''}${Math.round(s * 1000)} ms`;

export function SyncPanel({ song, controller, recording, onSongChange, onClose, autoRun, onAutoDone }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [view, setView] = useState({ startMs: 0, msPerPx: 25 }); // 25 ms/px ≈ 20 s on screen
  const history = useHistory<SyncState>(EMPTY);
  const state = history.value;
  const [beats, setBeats] = useState<ScoreBeat[] | null>(null);
  const [autoAnchors, setAutoAnchors] = useState<Anchor[] | undefined>();
  const [selected, setSelected] = useState<number | null>(null); // played bar index
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState<{ fraction: number; stage: string } | null>(null);
  const [tap, setTap] = useState<{ next: number } | null>(null);
  const [message, setMessage] = useState('');
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, number>());
  const pinch = useRef<{ dist: number; msPerPx: number } | null>(null);
  const positionMs = usePlayer((s) => s.positionMs);
  const theme = useSettings((s) => s.theme); // redraw the canvas when the theme changes
  // re-render when the controller has loaded the score (it's a mutable object)
  const scoreVersion = usePlayer((s) => s.scoreVersion);
  const tl: Timeline | null = controller.scoreTimeline;
  const ready = !!beats && !!tl;

  // start from the song's saved sync once the score is loaded
  const loadedFor = useRef<Timeline | null>(null);
  useEffect(() => {
    if (!tl || loadedFor.current === tl) return;
    loadedFor.current = tl;
    let live = true;
    void loadSync(song, tl).then((s) => {
      if (!live) return;
      setBeats(s.beats);
      setAutoAnchors(s.autoAnchors);
      history.reset({ anchors: s.anchors, globalOffset: s.globalOffset });
      if (s.outdated) setMessage('Auto-sync has improved since this song was synced. Run it again to update it (your pinned bars are kept).');
    });
    return () => { live = false; };
  }, [tl, scoreVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Anchor index of each played bar's first beat. */
  const downbeats = useMemo(() => {
    const out: number[] = [];
    for (const b of beats ?? []) if (b.isDownbeat) out[b.playedIndex] = b.index;
    return out;
  }, [beats]);

  // waveform
  useEffect(() => {
    if (!recording) return;
    let live = true;
    void decodeForAnalysis(recording).then((a) => { if (live) setPeaks(waveformPeaks(a)); });
    return () => { live = false; };
  }, [recording]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // live preview in the tab + autosave (debounced)
  const songRef = useRef(song);
  songRef.current = song;
  useEffect(() => {
    if (!tl || !beats || !state.anchors.length) return;
    controller.setSyncPoints(anchorsToPlayerPoints(tl, beats, state.anchors, state.globalOffset));
    if (!history.touched) return;
    const t = setTimeout(() => { void saveSync(songRef.current, tl, beats, state).then(onSongChange); }, 600);
    return () => clearTimeout(t);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const toX = useCallback((ms: number) => (ms - view.startMs) / view.msPerPx, [view]);
  const toMs = useCallback((x: number) => view.startMs + x * view.msPerPx, [view]);
  /** Recording ms of an anchor (global offset applied). */
  const anchorMs = useCallback((i: number) => ((state.anchors[i]?.time ?? 0) + state.globalOffset) * 1000, [state]);

  const conf = useMemo(() => (tl && beats ? barConfidence(tl, beats, state.anchors) : []), [tl, beats, state.anchors]);
  const tempos = useMemo(() => (tl && beats ? barTempos(tl, beats, state.anchors) : []), [tl, beats, state.anchors]);
  const lowBars = useMemo(() => conf.flatMap((c, k) => (c < LOW_CONFIDENCE ? [k] : [])), [conf]);
  const pins = state.anchors.filter(isLocked).length;

  // ---- drawing ------------------------------------------------------------------------------
  useEffect(() => {
    // draw on the next frame: a theme change applies its CSS class after this effect runs
    const raf = requestAnimationFrame(() => draw());
    return () => cancelAnimationFrame(raf);
    function draw() {
      const c = canvas.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const h = WAVE_H + BARS_H;
      c.width = Math.round(width * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${width}px`;
      c.style.height = `${h}px`;
      const g = c.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const css = getComputedStyle(document.documentElement);
      const col = (n: string) => css.getPropertyValue(n).trim();
      g.fillStyle = col('--c-surface-2');
      g.fillRect(0, 0, width, WAVE_H);
      g.fillStyle = col('--c-surface');
      g.fillRect(0, WAVE_H, width, BARS_H);
      // waveform
      if (peaks) {
        g.fillStyle = col('--c-ink-2');
        const mid = WAVE_H / 2;
        for (let x = 0; x < width; x++) {
          const a = Math.floor(toMs(x) / peaks.bucketMs), b = Math.max(a + 1, Math.floor(toMs(x + 1) / peaks.bucketMs));
          let m = 0;
          for (let i = Math.max(0, a); i < Math.min(peaks.data.length, b); i++) m = Math.max(m, peaks.data[i]!);
          const hh = m * (mid - 4);
          if (hh > 0.3) g.fillRect(x, mid - hh, 1, hh * 2);
        }
      } else {
        g.fillStyle = col('--c-muted');
        g.font = '12px sans-serif';
        g.fillText(recording ? 'Loading waveform…' : 'No recording attached', 12, WAVE_H / 2);
      }
      if (!tl || !beats) return;
      // beats (between the bar lines), when there is room for them
      const beatPx = (60000 / Math.max(30, song.bpm || 120)) / view.msPerPx;
      if (beatPx > 8) {
        g.fillStyle = col('--c-line-strong');
        for (const b of beats) {
          if (b.isDownbeat) continue;
          const x = toX(anchorMs(b.index));
          if (x >= -2 && x <= width + 2) g.fillRect(x - 0.5, WAVE_H + BARS_H - 10, 1, 10);
        }
      }
      // bars: low-confidence tint, bar line, number, tempo, pin
      const warn = col('--c-warn');
      tl.played.forEach((p, k) => {
        const i = downbeats[k];
        if (i === undefined) return;
        const x = toX(anchorMs(i));
        const nextI = downbeats[k + 1];
        const x2 = nextI !== undefined ? toX(anchorMs(nextI)) : x + 4 * beatPx;
        if (x2 < -80 || x > width + 80) return;
        if ((conf[k] ?? 1) < LOW_CONFIDENCE) {
          g.globalAlpha = 0.16;
          g.fillStyle = warn;
          g.fillRect(x, WAVE_H, x2 - x, BARS_H);
          g.globalAlpha = 1;
        }
        const pinned = isLocked(state.anchors[i]!);
        const on = selected === k;
        g.fillStyle = pinned || on ? col('--c-accent') : col('--c-line');
        g.fillRect(x - 0.5, 0, 1, WAVE_H); // guide across the waveform
        g.fillStyle = pinned || on ? col('--c-accent') : col('--c-ink-2');
        g.fillRect(x - (pinned || on ? 1 : 0.5), WAVE_H, pinned || on ? 2 : 1, BARS_H);
        g.fillStyle = col('--c-ink');
        g.font = on ? '600 11px ui-monospace, monospace' : '11px ui-monospace, monospace';
        g.fillText(String(p.index + 1), x + 4, WAVE_H + 14);
        if (x2 - x > 48 && tempos[k]) {
          g.fillStyle = col('--c-ink-2');
          g.font = '10px system-ui, sans-serif';
          g.fillText(`♩ ${Math.round(tempos[k]!)}`, x + 4, WAVE_H + 30);
        }
        if (pinned) {
          g.fillStyle = col('--c-accent');
          g.beginPath();
          g.moveTo(x - 5, WAVE_H);
          g.lineTo(x + 5, WAVE_H);
          g.lineTo(x, WAVE_H + 7);
          g.fill();
        }
      });
      // playhead
      g.fillStyle = col('--c-danger');
      g.fillRect(toX(positionMs) - 1, 0, 2, WAVE_H + BARS_H);
    }
  }, [width, peaks, view, state, beats, downbeats, conf, tempos, selected, positionMs, recording, toMs, toX, anchorMs, tl, song.bpm, theme]);

  // keep the playhead in view while playing
  useEffect(() => {
    const x = toX(positionMs);
    if (x > width * 0.85 || x < 0) setView((v) => ({ ...v, startMs: Math.max(-2000, positionMs - width * 0.2 * v.msPerPx) }));
  }, [positionMs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- pointer interaction --------------------------------------------------------------------
  const nearestBarline = (x: number): number | null => {
    let best: number | null = null, bestD = 9;
    downbeats.forEach((i, k) => { const d = Math.abs(toX(anchorMs(i)) - x); if (d < bestD) { bestD = d; best = k; } });
    return best;
  };

  /** Drags bar `k`'s line to recording time `ms`. */
  const dragBar = (base: SyncState, k: number, ms: number, follow: boolean): SyncState => {
    const i = downbeats[k];
    if (i === undefined) return base;
    const t = ms / 1000 - base.globalOffset;
    const anchors = follow ? shiftFrom(base.anchors, i, t - base.anchors[i]!.time) : moveAnchor(base.anchors, i, t);
    return { ...base, anchors };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, e.clientX);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.abs(a! - b!) || 1, msPerPx: view.msPerPx };
      drag.current = null;
      return;
    }
    if (y < WAVE_H) drag.current = { kind: 'pan', x0: x, view0: view.startMs, moved: false };
    else if (ready) {
      const k = nearestBarline(x);
      drag.current = k !== null
        ? { kind: 'bar', played: k, x0: x, base: state, following: following || e.shiftKey, moved: false }
        : { kind: 'all', x0: x, base: state };
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, e.clientX);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const scale = pinch.current.dist / (Math.abs(a! - b!) || 1);
      setView((v) => ({ ...v, msPerPx: Math.max(1, Math.min(200, pinch.current!.msPerPx * scale)) }));
      return;
    }
    const d = drag.current;
    if (!d) {
      const inBars = e.clientY - r.top >= WAVE_H;
      e.currentTarget.style.cursor = inBars && nearestBarline(x) !== null ? 'ew-resize' : inBars ? 'move' : 'grab';
      return;
    }
    if (d.kind === 'pan') {
      if (Math.abs(x - d.x0) > 3) d.moved = true;
      setView((v) => ({ ...v, startMs: d.view0 - (x - d.x0) * v.msPerPx }));
    } else if (d.kind === 'all') {
      history.preview({ ...d.base, anchors: shiftAll(d.base.anchors, ((x - d.x0) * view.msPerPx) / 1000) });
    } else {
      if (!d.moved && Math.abs(x - d.x0) <= 3) return;
      d.moved = true;
      setSelected(d.played);
      const i = downbeats[d.played]!;
      const startMs = (d.base.anchors[i]!.time + d.base.globalOffset) * 1000;
      history.preview(dragBar(d.base, d.played, startMs + (x - d.x0) * view.msPerPx, d.following));
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'pan') {
      if (!d.moved) controller.seek(Math.max(0, toMs(e.clientX - e.currentTarget.getBoundingClientRect().left)));
    } else if (d.kind === 'bar' && !d.moved) {
      setSelected((s) => (s === d.played ? null : d.played)); // click on a bar line: select it
    } else history.commit();
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
      setView((v) => ({ ...v, startMs: v.startMs + (e.deltaX || e.deltaY) * v.msPerPx }));
    } else {
      const at = toMs(x);
      const msPerPx = Math.max(1, Math.min(200, view.msPerPx * Math.exp(e.deltaY * 0.002)));
      setView({ msPerPx, startMs: at - x * msPerPx });
    }
  };

  // ---- tools ------------------------------------------------------------------------------------
  const selAnchor = selected !== null ? downbeats[selected] : undefined;
  const selPinned = selAnchor !== undefined && !!state.anchors[selAnchor] && isLocked(state.anchors[selAnchor]!);
  const playheadBeat = () => Math.max(0, controller.locate(positionMs)?.playedIndex ?? 0);
  const beatSec = () => {
    const t = tempos[playheadBeat()];
    return 60 / (t && t > 0 ? t : song.bpm || 120);
  };
  const nudgeAll = (sec: number) => history.set({ ...state, anchors: shiftAll(state.anchors, sec) });
  const unpinSelected = () => { if (selAnchor !== undefined && selPinned) history.set({ ...state, anchors: unpin(state.anchors, selAnchor) }); };
  const unpinRef = useRef(unpinSelected);
  unpinRef.current = unpinSelected;

  // Delete / Backspace unpins the selected bar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !(e.target as HTMLElement | null)?.closest('input, textarea, select')) {
        e.preventDefault();
        unpinRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Jumps to the next bar that needs checking (after the playhead), and selects it. */
  const nextToCheck = () => {
    if (!lowBars.length) return;
    const now = playheadBeat();
    const k = lowBars.find((b) => b > now) ?? lowBars[0]!;
    const i = downbeats[k];
    if (i === undefined) return;
    setSelected(k);
    const ms = anchorMs(i);
    controller.seek(Math.max(0, ms - 1000));
    setView((v) => ({ ...v, startMs: ms - width * 0.3 * v.msPerPx }));
  };

  // tap mode: each tap pins the next bar's first beat
  const doTap = useCallback(() => {
    if (!tl || !tap) return;
    const i = downbeats[tap.next];
    if (i === undefined) { setTap(null); return; }
    const ms = usePlayer.getState().positionMs - TAP_LATENCY_MS;
    const cur = history.value;
    history.set({ ...cur, anchors: moveAnchor(cur.anchors, i, ms / 1000 - cur.globalOffset) });
    setTap({ next: tap.next + 1 });
  }, [tl, tap, history, downbeats]);

  useEffect(() => {
    if (!tap) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && !(e.target as HTMLElement | null)?.closest('input, textarea, select')) { e.preventDefault(); doTap(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tap, doTap]);

  const startTap = () => {
    if (!tl) return;
    const loc = controller.locate(positionMs);
    const next = loc ? Math.min(tl.played.length - 1, loc.barPosition < 0.5 ? loc.playedIndex : loc.playedIndex + 1) : 0;
    setTap({ next });
    setMessage(`Press K (or the Tap button) on the first beat of bar ${next + 1} and each bar after it.`);
    if (usePlayer.getState().state !== 'playing') controller.play();
  };
  const stopTap = () => { setTap(null); setMessage(''); };

  /**
   * Runs auto-sync, keeping the pinned bars. With `keepStart`, the song's first beat is pinned where it is
   * now first, so only the rest of the song is synced (for recordings where auto-sync gets the start wrong).
   */
  const autoSync = useCallback(async ({ keepStart = false }: { keepStart?: boolean } = {}) => {
    const score = controller.alphaTab?.score;
    if (!recording || !score || !tl || !beats) return;
    setBusy({ fraction: 0, stage: 'Starting' });
    setMessage('');
    try {
      const startWasPinned = !!history.value.anchors[0] && isLocked(history.value.anchors[0]);
      const base = keepStart ? pinStart(history.value.anchors) : history.value.anchors;
      const locked = base.filter(isLocked);
      const res = await runAutoSync(recording, score, tl, song.bpm, (fraction, stage) => setBusy({ fraction, stage }), locked);
      const next: SyncState = { anchors: res.anchors, globalOffset: history.value.globalOffset };
      const saved = await saveSync(song, tl, beats, next, {
        source: locked.length ? 'manual' : 'auto', confidence: res.confidence, autoAnchors: res.anchors, algoVersion: ALGO_VERSION,
      });
      onSongChange(saved);
      setAutoAnchors(res.anchors);
      history.reset(next);
      const pct = Math.round(res.confidence * 100);
      const low = barConfidence(tl, beats, res.anchors).filter((c) => c < LOW_CONFIDENCE).length;
      const notes = res.warnings.map((w) => ` ${w.detail}`).join('');
      setMessage((res.confidence >= 0.6
        ? `Synced automatically (confidence ${pct} %).${low ? ` ${low} bar${low > 1 ? 's' : ''} to check (tinted).` : ''} Play it to check.`
        : `Auto-sync isn't sure (confidence ${pct} %). Drag bar 1 onto the first beat in the waveform, then pin bars where it drifts, and run auto-sync again.`)
        + (keepStart && !startWasPinned ? ' The start was kept where it was (bar 1 is now pinned).' : '')
        + (locked.length && (!keepStart || startWasPinned || locked.length > 1) ? ` Your ${locked.length} pinned bar${locked.length > 1 ? 's were' : ' was'} kept.` : '') + notes);
      onAutoDone?.(res.confidence);
      const first = res.anchors[0];
      if (first) setView((v) => ({ ...v, startMs: Math.max(-1000, (first.time + next.globalOffset) * 1000 - 2000) }));
    } catch (err) {
      setMessage(`Auto-sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }, [controller, recording, tl, beats, song, onSongChange, history, onAutoDone]);

  const autoRan = useRef(false);
  useEffect(() => {
    // wait until the score *and* the recording are loaded, then run once
    if (autoRun && !autoRan.current && ready && recording && controller.alphaTab?.score) { autoRan.current = true; void autoSync(); }
  }, [autoRun, ready, recording, autoSync, controller, scoreVersion]);

  const sourceText = song.syncSource === 'auto' ? `auto-synced (${Math.round((song.syncConfidence ?? 0) * 100)} %)` : song.syncSource === 'manual' ? 'adjusted by hand' : 'not synced yet';

  return (
    <section className="border-t border-line bg-surface" aria-label="Sync tool">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <strong>Sync</strong>
        <span className="text-ink-2">{sourceText}{pins ? ` · ${pins} pinned` : ''}</span>
        <Button size="sm" variant="primary" onClick={() => void autoSync()} disabled={!!busy || !recording || !ready}
          title={pins ? 'Your pinned bars are kept; auto-sync fills in the bars between them' : undefined}>
          {pins ? 'Auto-sync between pins' : 'Auto-sync'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void autoSync({ keepStart: true })} disabled={!!busy || !recording || !ready}
          title="Keeps the start of the song where it is now and syncs the rest. Drag bar 1 onto the first beat first if it's off.">
          Sync, keep start
        </Button>
        {busy && (
          <span className="flex items-center gap-2 text-ink-2" role="status">
            <span className="h-1.5 w-24 overflow-hidden rounded bg-surface-2"><span className="block h-full bg-accent" style={{ width: `${Math.round(busy.fraction * 100)}%` }} /></span>
            {busy.stage}…
          </span>
        )}
        {lowBars.length > 0 && !busy && (
          <Button size="sm" variant="ghost" onClick={nextToCheck} title="Jump to the next bar auto-sync wasn't sure about">
            <span className="text-warn">● {lowBars.length} bar{lowBars.length > 1 ? 's' : ''} to check</span> · next
          </Button>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={history.undo} disabled={!history.canUndo} aria-label="Undo">↶ Undo</Button>
        <Button size="sm" variant="ghost" onClick={history.redo} disabled={!history.canRedo} aria-label="Redo">↷ Redo</Button>
        <Button size="sm" variant="ghost" onClick={() => { if (autoAnchors) { history.set({ ...state, anchors: autoAnchors }); setSelected(null); } }}
          disabled={!autoAnchors}>Reset to auto-sync</Button>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close sync tool">✕</Button>
      </div>

      <div className="flex flex-wrap items-center gap-1 px-3 pb-2 text-sm">
        <label className="mr-1 flex items-center gap-1.5 text-ink-2" title="Dragging a bar line moves that bar and everything after it (same as Shift-drag)">
          <input type="checkbox" checked={following} onChange={(e) => setFollowing(e.target.checked)} />
          Move following bars
        </label>
        <span className="text-ink-2">
          {selected !== null ? `Bar ${selected + 1}${tempos[selected] ? ` · ♩ ${Math.round(tempos[selected]!)}` : ''}${selPinned ? ' · pinned' : ''}` : ''}
        </span>
        <Button size="sm" variant="ghost" onClick={unpinSelected} disabled={!selPinned}>Unpin</Button>
        <span className="mx-2 h-5 w-px bg-line" />
        <Slider className="w-56" label="Offset" min={-OFFSET_RANGE_MS / 1000} max={OFFSET_RANGE_MS / 1000} step={0.005}
          value={state.globalOffset} format={fmtOffset} aria-label="Global offset"
          onChange={(v) => history.preview({ ...state, globalOffset: Math.round(v * 1000) / 1000 })}
          onPointerUp={() => history.commit()} onKeyUp={() => history.commit()} onBlur={() => history.commit()} />
        <span className="mx-2 h-5 w-px bg-line" />
        <span className="text-ink-2">Move all:</span>
        <Button size="sm" variant="ghost" onClick={() => nudgeAll(-beatSec())}>−1 beat</Button>
        <Button size="sm" variant="ghost" onClick={() => nudgeAll(-0.01)}>−10 ms</Button>
        <Button size="sm" variant="ghost" onClick={() => nudgeAll(0.01)}>+10 ms</Button>
        <Button size="sm" variant="ghost" onClick={() => nudgeAll(beatSec())}>+1 beat</Button>
        <span className="mx-2 h-5 w-px bg-line" />
        {tap ? (
          <>
            <Button size="sm" variant="primary" onClick={doTap}>Tap (K) · bar {tl?.played[tap.next] ? tap.next + 1 : '–'}</Button>
            <Button size="sm" variant="ghost" onClick={stopTap}>Stop tapping</Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={startTap} disabled={!recording || !ready}>Tap the downbeats</Button>
        )}
        <span className="mx-2 h-5 w-px bg-line" />
        <Button size="sm" variant="ghost" onClick={() => setView((v) => ({ ...v, msPerPx: Math.min(200, v.msPerPx * 1.5) }))} aria-label="Zoom out">−</Button>
        <Button size="sm" variant="ghost" onClick={() => setView((v) => ({ ...v, msPerPx: Math.max(1, v.msPerPx / 1.5) }))} aria-label="Zoom in">+</Button>
        <Button size="sm" variant="ghost" onClick={() => { controller.seek(Math.max(0, view.startMs)); controller.play(); }}>▶ Play from here</Button>
        <span className="font-mono text-xs text-ink-2">{fmtTime(view.startMs)}</span>
      </div>
      {message && <p className="px-3 pb-2 text-sm text-accent-ink" role="status">{message}</p>}
      <div ref={wrap} className="px-3 pb-3">
        <canvas
          ref={canvas}
          className="block touch-none rounded-control"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          aria-label="Sync timeline: waveform above, bars below"
        />
        <p className="mt-1 text-xs text-muted">
          Drag a bar line onto its beat in the waveform: that bar is pinned and the bars up to the next pins stretch ·
          Shift-drag (or “Move following bars”) moves a bar and everything after it · drag empty space to move everything ·
          click a bar line to select it, Delete unpins it · tinted bars need checking ·
          drag the waveform to scroll, click it to jump · scroll or pinch to zoom
        </p>
      </div>
    </section>
  );
}
