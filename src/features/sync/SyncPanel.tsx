// Manual sync tool: two stacked lanes like a video-editor timeline.
//   top    = recording waveform (drag to scroll, click to jump there)
//   bottom = the score's bars (drag empty space = shift everything; drag a barline = pin it)
// Every change is previewed live in the tab (cursor + metronome) and saved per song.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { repo } from '@/app/repo';
import type { Song, SyncPoint } from '@/data/types';
import type { PlayerController } from '@/features/player/PlayerController';
import { usePlayer } from '@/features/player/playerStore';
import { fmtTime } from '@/features/player/BottomBar';
import { decodeForAnalysis, runAutoSync, waveformPeaks, type Peaks } from '@/sync/runAutoSync';
import { createSyncMap, effectiveBpm, pinSyncPoint, retimeSyncPoints, shiftSyncPoints } from '@/sync/syncMap';
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
const BARS_H = 56;
const TAP_LATENCY_MS = 60;
const START: SyncPoint = { barIndex: 0, barOccurence: 0, barPosition: 0, millisecondOffset: 0 };

type Drag =
  | { kind: 'pan'; x0: number; view0: number; moved: boolean }
  | { kind: 'shift'; x0: number; base: SyncPoint[] }
  | { kind: 'pin'; played: number; base: SyncPoint[] };

export function SyncPanel({ song, controller, recording, onSongChange, onClose, autoRun, onAutoDone }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [view, setView] = useState({ startMs: 0, msPerPx: 25 }); // 25 ms/px ≈ 20 s on screen
  const history = useHistory<SyncPoint[]>(song.syncPoints.length ? song.syncPoints : [START]);
  const points = history.value;
  const [busy, setBusy] = useState<{ fraction: number; stage: string } | null>(null);
  const [bpm, setBpm] = useState(song.bpm);
  /** BPM field while typing: the points it started from, so each keystroke re-times from the same base. */
  const [bpmEdit, setBpmEdit] = useState<{ text: string; base: SyncPoint[] } | null>(null);
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
    controller.setSyncPoints(points);
    if (!history.touched) return;
    const t = setTimeout(() => {
      void repo.saveSyncPoints(songRef.current.id, points, 'manual', songRef.current.syncConfidence).then(onSongChange);
    }, 600);
    return () => clearTimeout(t);
  }, [points]); // eslint-disable-line react-hooks/exhaustive-deps

  const toX = useCallback((ms: number) => (ms - view.startMs) / view.msPerPx, [view]);
  const toMs = useCallback((x: number) => view.startMs + x * view.msPerPx, [view]);

  // ---- drawing ------------------------------------------------------------------------------
  const barTimes = useCallback(() => {
    if (!tl) return [];
    const map = createSyncMap(tl, points);
    const pinned = new Set(points.filter((p) => p.barPosition === 0).map((p) => `${p.barIndex}:${p.barOccurence}`));
    return tl.played.map((p) => ({ ms: map.beatToMs(p.startBeat), p, pinned: pinned.has(`${p.barIndex}:${p.occurrence}`) }));
  }, [tl, points, scoreVersion]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // bars
    g.font = '11px ui-monospace, monospace';
    for (const { ms, p, pinned } of barTimes()) {
      const x = toX(ms);
      if (x < -40 || x > width + 40) continue;
      g.fillStyle = pinned ? col('--c-accent') : col('--c-line');
      g.fillRect(x - 0.5, 0, 1, WAVE_H); // guide across the waveform
      g.fillStyle = pinned ? col('--c-accent') : col('--c-ink-2');
      g.fillRect(x - 1, WAVE_H, 2, BARS_H);
      if (pinned) { g.beginPath(); g.arc(x, WAVE_H + BARS_H - 10, 4, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = col('--c-ink');
      g.fillText(`${p.barIndex + 1}${p.occurrence ? '′'.repeat(Math.min(2, p.occurrence)) : ''}`, x + 4, WAVE_H + 16);
    }
    // playhead
    g.fillStyle = col('--c-danger');
    g.fillRect(toX(positionMs) - 1, 0, 2, WAVE_H + BARS_H);
    }
  }, [width, peaks, view, barTimes, positionMs, recording, toMs, toX, theme]);

  // keep the playhead in view while playing
  useEffect(() => {
    const x = toX(positionMs);
    if (x > width * 0.85 || x < 0) setView((v) => ({ ...v, startMs: Math.max(-2000, positionMs - width * 0.2 * v.msPerPx) }));
  }, [positionMs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- pointer interaction --------------------------------------------------------------------
  const nearestBarline = (x: number): number | null => {
    let best: number | null = null, bestD = 9;
    barTimes().forEach(({ ms }, k) => { const d = Math.abs(toX(ms) - x); if (d < bestD) { bestD = d; best = k; } });
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
      drag.current = k !== null ? { kind: 'pin', played: k, base: points } : { kind: 'shift', x0: x, base: points };
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
      e.currentTarget.style.cursor = e.clientY - r.top >= WAVE_H && nearestBarline(x) !== null ? 'ew-resize' : e.clientY - r.top < WAVE_H ? 'grab' : 'move';
      return;
    }
    if (d.kind === 'pan') {
      if (Math.abs(x - d.x0) > 3) d.moved = true;
      setView((v) => ({ ...v, startMs: d.view0 - (x - d.x0) * v.msPerPx }));
    } else if (d.kind === 'shift') {
      history.preview(shiftSyncPoints(d.base, (x - d.x0) * view.msPerPx));
    } else if (tl) {
      const p = tl.played[d.played]!;
      history.preview(pinSyncPoint(tl, d.base, { barIndex: p.barIndex, barOccurence: p.occurrence, barPosition: 0, millisecondOffset: toMs(x) }));
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
  const beatMs = () => {
    const map = controller.currentSyncMap;
    if (!map) return 500;
    const b = map.msToBeat(positionMs);
    return map.beatToMs(b + 1) - map.beatToMs(b);
  };
  const nudge = (ms: number) => { history.set(shiftSyncPoints(points, ms)); };

  // BPM = the recording's tempo as the bars are laid out now; changing it spreads or squeezes the bars
  const shownBpm = tl ? Math.round(effectiveBpm(tl, points) * 10) / 10 : song.bpm;
  const saveBpm = (n: number) => { setBpm(n); void repo.updateSong(song.id, { bpm: n }).then(onSongChange); };
  const typeBpm = (text: string) => {
    const base = bpmEdit?.base ?? points;
    setBpmEdit({ text, base });
    const n = Number(text);
    if (tl && n >= 20 && n <= 400) history.preview(retimeSyncPoints(tl, base, n));
  };
  const endBpmEdit = () => {
    if (!bpmEdit) return;
    const n = Number(bpmEdit.text);
    setBpmEdit(null);
    if (n >= 20 && n <= 400) { history.commit(); saveBpm(n); } else history.preview(bpmEdit.base);
  };
  const stepBpm = (d: number) => {
    if (!tl) return;
    const n = Math.max(20, Math.min(400, Math.round(shownBpm) + d));
    history.set(retimeSyncPoints(tl, points, n));
    saveBpm(n);
  };

  const doTap = useCallback(() => {
    if (!tl || !tap) return;
    const p = tl.played[tap.next];
    if (!p) { setTap(null); return; }
    const ms = usePlayer.getState().positionMs - TAP_LATENCY_MS;
    history.set(pinSyncPoint(tl, history.value, { barIndex: p.barIndex, barOccurence: p.occurrence, barPosition: 0, millisecondOffset: ms }));
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

  const autoSync = useCallback(async () => {
    const score = controller.alphaTab?.score;
    if (!recording || !score || !tl) return;
    setBusy({ fraction: 0, stage: 'Starting' });
    setMessage('');
    try {
      const res = await runAutoSync(recording, score, tl, bpm, (fraction, stage) => setBusy({ fraction, stage }));
      const saved = await repo.updateSong(song.id, { syncPoints: res.syncPoints, autoSyncPoints: res.syncPoints, syncSource: 'auto', syncConfidence: res.confidence, bpm });
      onSongChange(saved);
      history.reset(res.syncPoints);
      setMessage(res.confidence >= 0.6
        ? `Synced automatically (confidence ${Math.round(res.confidence * 100)} %). Play it to check.`
        : `Auto-sync isn't sure (confidence ${Math.round(res.confidence * 100)} %). Drag the bar lane to line up bar 1, or tap along.`);
      onAutoDone?.(res.confidence);
      const first = res.syncPoints[0];
      if (first) setView((v) => ({ ...v, startMs: Math.max(-1000, first.millisecondOffset - 2000) }));
    } catch (err) {
      setMessage(`Auto-sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }, [controller, recording, tl, bpm, song.id, onSongChange, history, onAutoDone]);

  const autoRan = useRef(false);
  useEffect(() => {
    // wait until the score *and* the recording are loaded, then run once
    if (autoRun && !autoRan.current && recording && tl && controller.alphaTab?.score) { autoRan.current = true; void autoSync(); }
  }, [autoRun, recording, tl, autoSync, controller, scoreVersion]);

  const sourceText = song.syncSource === 'auto' ? `auto-synced (${Math.round((song.syncConfidence ?? 0) * 100)} %)` : song.syncSource === 'manual' ? 'adjusted by hand' : 'not synced yet';

  return (
    <section className="border-t border-line bg-surface" aria-label="Sync tool">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <strong>Sync</strong>
        <span className="text-ink-2">{sourceText}</span>
        <label className="ml-2 flex items-center gap-1 text-ink-2" title="Tempo of the recording: changing it moves the bars closer together or further apart">BPM
          <Button size="sm" variant="ghost" onClick={() => stepBpm(-1)} aria-label="Slower">−</Button>
          <input inputMode="decimal" value={bpmEdit?.text ?? String(shownBpm)}
            onChange={(e) => typeBpm(e.target.value.replace(/[^\d.]/g, ''))}
            onBlur={endBpmEdit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            className="h-8 w-16 rounded-control border border-line bg-surface px-2 text-center text-ink tabular-nums" />
          <Button size="sm" variant="ghost" onClick={() => stepBpm(1)} aria-label="Faster">+</Button>
        </label>
        <Button size="sm" variant="primary" onClick={() => void autoSync()} disabled={!!busy || !recording}>Auto-sync</Button>
        {busy && (
          <span className="flex items-center gap-2 text-ink-2" role="status">
            <span className="h-1.5 w-24 overflow-hidden rounded bg-surface-2"><span className="block h-full bg-accent" style={{ width: `${Math.round(busy.fraction * 100)}%` }} /></span>
            {busy.stage}…
          </span>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={history.undo} disabled={!history.canUndo} aria-label="Undo">↶ Undo</Button>
        <Button size="sm" variant="ghost" onClick={history.redo} disabled={!history.canRedo} aria-label="Redo">↷ Redo</Button>
        <Button size="sm" variant="ghost" onClick={() => song.autoSyncPoints && history.set(song.autoSyncPoints)} disabled={!song.autoSyncPoints}>Reset to auto-sync</Button>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close sync tool">✕</Button>
      </div>
      <div className="flex flex-wrap items-center gap-1 px-3 pb-2 text-sm">
        <span className="text-ink-2">Shift all:</span>
        <Button size="sm" variant="ghost" onClick={() => nudge(-beatMs())}>−1 beat</Button>
        <Button size="sm" variant="ghost" onClick={() => nudge(-10)}>−10 ms</Button>
        <Button size="sm" variant="ghost" onClick={() => nudge(10)}>+10 ms</Button>
        <Button size="sm" variant="ghost" onClick={() => nudge(beatMs())}>+1 beat</Button>
        <span className="mx-2 h-5 w-px bg-line" />
        {tap ? (
          <>
            <Button size="sm" variant="primary" onClick={doTap}>Tap (K) · bar {tl?.played[tap.next] ? tl.played[tap.next]!.barIndex + 1 : '–'}</Button>
            <Button size="sm" variant="ghost" onClick={() => { setTap(null); setMessage(''); }}>Stop tapping</Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={startTap} disabled={!recording}>Tap the downbeats</Button>
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
          Drag the bar lane to move everything · drag a barline to pin that bar to the music · drag the waveform to scroll, click it to jump there · scroll or pinch to zoom
        </p>
      </div>
    </section>
  );
}
