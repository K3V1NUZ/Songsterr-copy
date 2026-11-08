// Manual sync tool: two stacked lanes like a video-editor timeline.
//   top    = recording waveform (drag to scroll, click to jump there)
//   bottom = the score's bars with tempo marks
// A tempo mark says "from this bar on, the recording plays at N BPM". Click a barline to add a
// mark, select it and set its BPM; bars after it follow until the next mark. Dragging a barline
// lines that bar up with the music (it changes the BPM of the mark before it). Dragging empty space
// moves everything. Every change is previewed live in the tab and saved per song.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { repo } from '@/app/repo';
import type { Song, TempoMark } from '@/data/types';
import type { PlayerController } from '@/features/player/PlayerController';
import { usePlayer } from '@/features/player/playerStore';
import { fmtTime } from '@/features/player/BottomBar';
import { decodeForAnalysis, runAutoSync, waveformPeaks, type Peaks } from '@/sync/runAutoSync';
import { createSyncMap } from '@/sync/syncMap';
import {
  addMark, layoutMarks, markAt, markIndex, marksFromSyncPoints, MAX_BPM, MIN_BPM, moveMark, removeMark, setMarkBpm, setMarkSignature, shiftMarks,
  simplifyMarks, syncPointsFromMarks,
} from '@/sync/tempoMarks';
import type { Timeline } from '@/sync/timeline';
import { useHistory } from './useHistory';
import { useSettings } from '@/store/settings';

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
const AUTO_TOLERANCE_MS = 20;
const TAP_TOLERANCE_MS = 35;

type Drag =
  | { kind: 'pan'; x0: number; view0: number; moved: boolean }
  | { kind: 'shift'; x0: number; base: TempoMark[] }
  | { kind: 'bar'; played: number; x0: number; base: TempoMark[]; moved: boolean };

/** Marks to start from: saved marks, or converted from older sync points, or one mark at bar 1. */
function initialMarks(tl: Timeline, song: Song): TempoMark[] {
  if (song.tempoMarks?.length) return layoutMarks(tl, song.tempoMarks);
  if (song.syncPoints.length) return simplifyMarks(tl, marksFromSyncPoints(tl, song.syncPoints, song.bpm), 10);
  const first = tl.played[0];
  return first ? [{ barIndex: first.barIndex, barOccurence: first.occurrence, millisecondOffset: 0, bpm: song.bpm }] : [];
}

const fromAuto = (tl: Timeline, points: Song['syncPoints'], bpm: number) =>
  simplifyMarks(tl, marksFromSyncPoints(tl, points, bpm), AUTO_TOLERANCE_MS);

const fmtBpm = (bpm: number) => String(Math.round(bpm * 10) / 10);
/** Bars are numbered in the order they are played: a repeated bar just gets the next number. */
const barName = (p: { index: number }) => String(p.index + 1);
const SIGNATURES: Array<[number, number]> = [[2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [3, 8], [5, 8], [6, 8], [7, 8], [9, 8], [12, 8]];
const sigText = (s: [number, number]) => `${s[0]}/${s[1]}`;

export function SyncPanel({ song, controller, recording, onSongChange, onClose, autoRun, onAutoDone }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [view, setView] = useState({ startMs: 0, msPerPx: 25 }); // 25 ms/px ≈ 20 s on screen
  const history = useHistory<TempoMark[]>([]);
  const marks = history.value;
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState<{ fraction: number; stage: string } | null>(null);
  /** BPM field while typing: the marks it started from, so each keystroke re-times from the same base. */
  const [bpmEdit, setBpmEdit] = useState<{ text: string; base: TempoMark[] } | null>(null);
  const [tap, setTap] = useState<{ next: number } | null>(null);
  const [message, setMessage] = useState('');
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, number>());
  const pinch = useRef<{ dist: number; msPerPx: number } | null>(null);
  const positionMs = usePlayer((s) => s.positionMs);
  const theme = useSettings((s) => s.theme); // redraw the canvas when the theme changes
  // re-render when the controller has loaded the score (it's a mutable object)
  const scoreVersion = usePlayer((s) => s.scoreVersion);
  const tl = controller.scoreTimeline;

  // start from the song's sync once the score is loaded
  useEffect(() => {
    if (!tl || ready) return;
    history.reset(initialMarks(tl, song));
    setReady(true);
  }, [tl, ready, scoreVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = Math.min(selected, Math.max(0, marks.length - 1));
  const points = useMemo(() => (tl && ready ? syncPointsFromMarks(tl, marks) : []), [tl, ready, marks]);

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
    if (!ready) return;
    controller.setSyncPoints(points, marks);
    if (!history.touched) return;
    const t = setTimeout(() => {
      const s = songRef.current;
      void repo.updateSong(s.id, { tempoMarks: marks, syncPoints: points, syncSource: 'manual', syncVersion: s.syncVersion + 1 }).then(onSongChange);
    }, 600);
    return () => clearTimeout(t);
  }, [points]); // eslint-disable-line react-hooks/exhaustive-deps

  const toX = useCallback((ms: number) => (ms - view.startMs) / view.msPerPx, [view]);
  const toMs = useCallback((x: number) => view.startMs + x * view.msPerPx, [view]);

  // ---- drawing ------------------------------------------------------------------------------
  const barTimes = useMemo(() => {
    if (!tl || !ready) return [];
    const map = createSyncMap(tl, points);
    const markAtBar = new Map(marks.map((m, i) => [markIndex(tl, m), i] as const));
    return tl.played.map((p, k) => ({ ms: map.beatToMs(p.startBeat), p, mark: markAtBar.get(k) }));
  }, [tl, ready, points, marks]);

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
      // bars and tempo marks
      for (const { ms, p, mark } of barTimes) {
        const x = toX(ms);
        if (x < -80 || x > width + 80) continue;
        const isMark = mark !== undefined;
        g.fillStyle = isMark ? col('--c-accent') : col('--c-line');
        g.fillRect(x - 0.5, 0, 1, WAVE_H); // guide across the waveform
        g.fillStyle = isMark ? col('--c-accent') : col('--c-ink-2');
        g.fillRect(x - (isMark ? 1 : 0.5), WAVE_H, isMark ? 2 : 1, BARS_H);
        g.fillStyle = col('--c-ink');
        g.font = '11px ui-monospace, monospace';
        g.fillText(barName(p), x + 4, WAVE_H + 14);
        if (isMark) {
          const m = marks[mark]!;
          const text = `♩ ${fmtBpm(m.bpm)}${m.timeSignature ? ` · ${sigText(m.timeSignature)}` : ''}`;
          g.font = '600 11px system-ui, sans-serif';
          const w = g.measureText(text).width + 10;
          const y = WAVE_H + BARS_H - 24;
          const on = mark === sel;
          g.fillStyle = on ? col('--c-accent') : col('--c-surface');
          g.strokeStyle = col('--c-accent');
          g.beginPath();
          g.roundRect(x, y, w, 18, 3);
          g.fill();
          g.stroke();
          g.fillStyle = on ? col('--c-on-accent') : col('--c-accent-ink');
          g.fillText(text, x + 5, y + 13);
        }
      }
      // playhead
      g.fillStyle = col('--c-danger');
      g.fillRect(toX(positionMs) - 1, 0, 2, WAVE_H + BARS_H);
    }
  }, [width, peaks, view, barTimes, marks, sel, positionMs, recording, toMs, toX, theme]);

  // keep the playhead in view while playing
  useEffect(() => {
    const x = toX(positionMs);
    if (x > width * 0.85 || x < 0) setView((v) => ({ ...v, startMs: Math.max(-2000, positionMs - width * 0.2 * v.msPerPx) }));
  }, [positionMs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- editing helpers ----------------------------------------------------------------------
  /** Marks with one at `played` (added if missing), and that mark's index. */
  const withMarkAt = (base: TempoMark[], played: number): [TempoMark[], number] => {
    if (!tl) return [base, -1];
    const next = addMark(tl, base, played);
    return [next, next.findIndex((m) => markIndex(tl, m) === played)];
  };

  const select = (i: number) => { setSelected(i); setBpmEdit(null); };

  // ---- pointer interaction --------------------------------------------------------------------
  const nearestBarline = (x: number): number | null => {
    let best: number | null = null, bestD = 9;
    barTimes.forEach(({ ms }, k) => { const d = Math.abs(toX(ms) - x); if (d < bestD) { bestD = d; best = k; } });
    return best;
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
    else {
      const k = nearestBarline(x);
      drag.current = k !== null ? { kind: 'bar', played: k, x0: x, base: marks, moved: false } : { kind: 'shift', x0: x, base: marks };
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
    } else if (d.kind === 'shift') {
      history.preview(shiftMarks(d.base, (x - d.x0) * view.msPerPx));
    } else if (tl) {
      if (!d.moved && Math.abs(x - d.x0) <= 3) return;
      d.moved = true;
      const [base, i] = withMarkAt(d.base, d.played);
      if (i < 0) return;
      setSelected(i);
      history.preview(moveMark(tl, base, i, toMs(x)));
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
      // click on a barline: select its mark, or add one there
      const [next, i] = withMarkAt(marks, d.played);
      if (next !== marks) history.set(next);
      if (i >= 0) select(i);
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
  const selMark = marks[sel];
  const selBar = tl && selMark ? tl.played[markIndex(tl, selMark)] : undefined;
  const playheadBar = () => Math.max(0, controller.locate(positionMs)?.playedIndex ?? 0);
  const beatMs = () => {
    const m = tl ? marks[markAt(tl, marks, playheadBar())] : undefined;
    return 60000 / (m?.bpm ?? song.bpm);
  };
  const nudge = (ms: number) => history.set(shiftMarks(marks, ms));

  // BPM of the selected mark (from its bar until the next mark)
  const typeBpm = (text: string) => {
    if (!tl) return;
    const base = bpmEdit?.base ?? marks;
    setBpmEdit({ text, base });
    const n = Number(text);
    if (n >= MIN_BPM && n <= MAX_BPM) history.preview(setMarkBpm(tl, base, sel, n));
  };
  const endBpmEdit = () => {
    if (!bpmEdit) return;
    const n = Number(bpmEdit.text);
    setBpmEdit(null);
    if (n >= MIN_BPM && n <= MAX_BPM) history.commit(); else history.preview(bpmEdit.base);
  };
  const stepBpm = (d: number) => {
    if (!tl || !selMark) return;
    history.set(setMarkBpm(tl, marks, sel, Math.round(selMark.bpm) + d));
  };
  const addAtPlayhead = () => {
    const [next, i] = withMarkAt(marks, playheadBar());
    if (next !== marks) history.set(next);
    if (i >= 0) select(i);
  };
  const removeSelected = () => {
    if (!tl || sel <= 0) return;
    history.set(removeMark(tl, marks, sel));
    select(sel - 1);
  };
  const removeRef = useRef(removeSelected);
  removeRef.current = removeSelected;

  // Delete / Backspace removes the selected mark
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !(e.target as HTMLElement | null)?.closest('input, textarea, select')) {
        e.preventDefault();
        removeRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // tapping the downbeats: each tap lines up one bar
  const doTap = useCallback(() => {
    if (!tl || !tap) return;
    const p = tl.played[tap.next];
    if (!p) { setTap(null); return; }
    const ms = usePlayer.getState().positionMs - TAP_LATENCY_MS;
    const next = addMark(tl, history.value, tap.next);
    const i = next.findIndex((m) => markIndex(tl, m) === tap.next);
    if (i >= 0) history.set(moveMark(tl, next, i, ms));
    setTap({ next: tap.next + 1 });
  }, [tl, tap, history]);

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
    setMessage(`Press K (or the Tap button) on the first beat of bar ${tl.played[next]!.barIndex + 1} and each bar after it.`);
    if (usePlayer.getState().state !== 'playing') controller.play();
  };
  const stopTap = () => {
    setTap(null);
    setMessage('');
    if (tl) history.set(simplifyMarks(tl, marks, TAP_TOLERANCE_MS)); // keep only real tempo changes
  };

  const autoSync = useCallback(async () => {
    const score = controller.alphaTab?.score;
    if (!recording || !score || !tl) return;
    setBusy({ fraction: 0, stage: 'Starting' });
    setMessage('');
    try {
      const res = await runAutoSync(recording, score, tl, song.bpm, (fraction, stage) => setBusy({ fraction, stage }));
      const next = fromAuto(tl, res.syncPoints, song.bpm);
      const saved = await repo.updateSong(song.id, {
        tempoMarks: next, syncPoints: syncPointsFromMarks(tl, next), autoSyncPoints: res.syncPoints,
        syncSource: 'auto', syncConfidence: res.confidence, syncVersion: song.syncVersion + 1,
      });
      onSongChange(saved);
      history.reset(next);
      setSelected(0);
      setMessage(res.confidence >= 0.6
        ? `Synced automatically (confidence ${Math.round(res.confidence * 100)} %). Play it to check.`
        : `Auto-sync isn't sure (confidence ${Math.round(res.confidence * 100)} %). Drag bar 1 to where the song starts, then add tempo marks where it speeds up or slows down.`);
      onAutoDone?.(res.confidence);
      const first = next[0];
      if (first) setView((v) => ({ ...v, startMs: Math.max(-1000, first.millisecondOffset - 2000) }));
    } catch (err) {
      setMessage(`Auto-sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }, [controller, recording, tl, song.bpm, song.id, song.syncVersion, onSongChange, history, onAutoDone]);

  const autoRan = useRef(false);
  useEffect(() => {
    // wait until the score *and* the recording are loaded, then run once
    if (autoRun && !autoRan.current && ready && recording && tl && controller.alphaTab?.score) { autoRan.current = true; void autoSync(); }
  }, [autoRun, ready, recording, tl, autoSync, controller, scoreVersion]);

  const sourceText = song.syncSource === 'auto' ? `auto-synced (${Math.round((song.syncConfidence ?? 0) * 100)} %)` : song.syncSource === 'manual' ? 'adjusted by hand' : 'not synced yet';

  return (
    <section className="border-t border-line bg-surface" aria-label="Sync tool">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <strong>Sync</strong>
        <span className="text-ink-2">{sourceText}</span>
        <Button size="sm" variant="primary" onClick={() => void autoSync()} disabled={!!busy || !recording || !ready}>Auto-sync</Button>
        {busy && (
          <span className="flex items-center gap-2 text-ink-2" role="status">
            <span className="h-1.5 w-24 overflow-hidden rounded bg-surface-2"><span className="block h-full bg-accent" style={{ width: `${Math.round(busy.fraction * 100)}%` }} /></span>
            {busy.stage}…
          </span>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={history.undo} disabled={!history.canUndo} aria-label="Undo">↶ Undo</Button>
        <Button size="sm" variant="ghost" onClick={history.redo} disabled={!history.canRedo} aria-label="Redo">↷ Redo</Button>
        <Button size="sm" variant="ghost" onClick={() => { if (tl && song.autoSyncPoints) { history.set(fromAuto(tl, song.autoSyncPoints, song.bpm)); select(0); } }}
          disabled={!song.autoSyncPoints}>Reset to auto-sync</Button>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close sync tool">✕</Button>
      </div>

      <div className="flex flex-wrap items-center gap-1 px-3 pb-2 text-sm">
        <span className="mr-1 text-ink-2">{selBar ? `Tempo from bar ${barName(selBar)}:` : 'Tempo:'}</span>
        <Button size="sm" variant="ghost" onClick={() => stepBpm(-1)} disabled={!selMark} aria-label="Slower">−</Button>
        <input inputMode="decimal" aria-label="BPM of the selected tempo mark" disabled={!selMark}
          value={bpmEdit?.text ?? (selMark ? fmtBpm(selMark.bpm) : '')}
          onChange={(e) => typeBpm(e.target.value.replace(/[^\d.]/g, ''))}
          onBlur={endBpmEdit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          className="h-8 w-16 rounded-control border border-line bg-surface px-2 text-center text-ink tabular-nums" />
        <Button size="sm" variant="ghost" onClick={() => stepBpm(1)} disabled={!selMark} aria-label="Faster">+</Button>
        <span className="text-ink-2">BPM</span>
        <select aria-label="Bar length from the selected tempo mark" disabled={!selMark}
          title="Bar length in the recording from this mark until the next one — for when it differs from the score"
          value={selMark?.timeSignature ? sigText(selMark.timeSignature) : ''}
          onChange={(e) => {
            if (!tl) return;
            const sig = SIGNATURES.find((x) => sigText(x) === e.target.value);
            history.set(setMarkSignature(tl, marks, sel, sig));
          }}
          className="ml-1 h-8 rounded-control border border-line bg-surface px-1.5 text-ink">
          <option value="">Bars as written</option>
          {SIGNATURES.map((x) => <option key={sigText(x)} value={sigText(x)}>Bars in {sigText(x)}</option>)}
        </select>
        <Button size="sm" variant="ghost" onClick={removeSelected} disabled={sel <= 0}>Remove mark</Button>
        <Button size="sm" variant="ghost" onClick={addAtPlayhead} disabled={!ready}>+ Mark at playhead</Button>
        <span className="mx-2 h-5 w-px bg-line" />
        <span className="text-ink-2">Move all:</span>
        <Button size="sm" variant="ghost" onClick={() => nudge(-beatMs())}>−1 beat</Button>
        <Button size="sm" variant="ghost" onClick={() => nudge(-10)}>−10 ms</Button>
        <Button size="sm" variant="ghost" onClick={() => nudge(10)}>+10 ms</Button>
        <Button size="sm" variant="ghost" onClick={() => nudge(beatMs())}>+1 beat</Button>
        <span className="mx-2 h-5 w-px bg-line" />
        {tap ? (
          <>
            <Button size="sm" variant="primary" onClick={doTap}>Tap (K) · bar {tl?.played[tap.next] ? tl.played[tap.next]!.barIndex + 1 : '–'}</Button>
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
          aria-label="Sync timeline: waveform above, bars and tempo marks below"
        />
        <p className="mt-1 text-xs text-muted">
          Click a barline to add a tempo mark (or select one), then set its BPM and, if the recording's bars differ from the score, their length — both hold until the next mark ·
          drag a barline onto its beat in the waveform · drag empty space to move everything · Delete removes the selected mark ·
          drag the waveform to scroll, click it to jump · scroll or pinch to zoom
        </p>
      </div>
    </section>
  );
}
