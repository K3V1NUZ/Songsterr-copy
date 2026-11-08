// Bottom bar: seekable progress line, transport, speed, loop (+ speed trainer),
// metronome, count-in, view, zoom, sync and mixer.
import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Icon } from '@/components/icons';
import { Button, cx, IconButton, MenuItem, Popover, Slider, Toggle } from '@/components/ui';
import type { ScoreView } from './AlphaTabView';
import type { PlayerController } from './PlayerController';
import { usePlayer } from './playerStore';

export const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const SPEEDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 1, 1.1, 1.25];
const VIEWS: Array<[ScoreView, string]> = [['tab', 'Tab'], ['tab+score', 'Tab + notes'], ['score', 'Notes']];

interface Props {
  controller: PlayerController;
  view: ScoreView;
  onView: (v: ScoreView) => void;
  zoom: number;
  onZoom: (z: number) => void;
  mixerOpen: boolean;
  onToggleMixer: () => void;
  syncOpen: boolean;
  /** Only in recording mode. */
  onToggleSync?: () => void;
  tracksOpen: boolean;
  onToggleTracks: () => void;
  barLabel: string;
}

export function BottomBar(p: Props) {
  const { controller } = p;
  const s = usePlayer();
  const [pop, setPop] = useState<'speed' | 'loop' | 'count' | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const playing = s.state === 'playing' || s.state === 'counting-in';
  const media = s.mode === 'media';
  const dur = Math.max(1, s.durationMs);

  const seekAt = (e: RPointerEvent<HTMLDivElement>) => {
    const r = bar.current!.getBoundingClientRect();
    controller.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur);
  };

  return (
    <footer className="relative flex h-14 shrink-0 items-center gap-0.5 overflow-x-clip border-t border-line bg-surface px-1.5 sm:gap-1 md:px-3">
      {/* progress line: click or drag to seek */}
      <div ref={bar} role="slider" aria-label="Position" aria-valuemin={0} aria-valuemax={Math.round(dur / 1000)} aria-valuenow={Math.round(s.positionMs / 1000)}
        tabIndex={-1}
        className="group absolute inset-x-0 -top-[5px] h-[9px] cursor-pointer"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); seekAt(e); }}
        onPointerMove={(e) => { if (e.buttons) seekAt(e); }}>
        <div className="absolute inset-x-0 top-1 h-[2px] bg-line group-hover:h-1" />
        {s.loop && s.loop.endMs > 0 && (
          <div className="absolute top-1 h-[2px] bg-loop group-hover:h-1" style={{ left: `${(s.loop.startMs / dur) * 100}%`, width: `${((s.loop.endMs - s.loop.startMs) / dur) * 100}%` }} />
        )}
        <div className="absolute top-1 left-0 h-[2px] bg-accent group-hover:h-1" style={{ width: `${Math.min(100, (s.positionMs / dur) * 100)}%` }} />
      </div>

      <IconButton icon="sidebar" label="Instruments" active={p.tracksOpen} onClick={p.onToggleTracks} />
      <IconButton icon="prev" label="Back to start (Home)" onClick={() => controller.seek(0)} disabled={!s.ready} className="max-sm:hidden" />
      <button type="button" onClick={() => controller.toggle()} disabled={!s.ready} aria-label={playing ? 'Pause' : 'Play'}
        className="mx-1 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-play text-on-play disabled:opacity-40">
        <Icon name={playing ? 'pause' : 'play'} size={16} />
      </button>
      <div className="mr-1 ml-0.5 font-mono text-xs whitespace-nowrap text-ink-2 tabular-nums sm:mr-2 sm:ml-1">
        {s.countIn ? <span className="font-sans font-semibold text-accent">Count-in {s.countIn.beat} / {s.countIn.of}</span>
          : <>{fmtTime(s.positionMs)}<span className="max-sm:hidden"> / {fmtTime(s.durationMs)}</span><span className="max-lg:hidden"> · {p.barLabel}</span></>}
      </div>

      <div className="relative">
        <Button variant="ghost" onClick={() => setPop(pop === 'speed' ? null : 'speed')} active={s.speed !== 1} title="Speed (− / +)">
          <span className="max-sm:hidden">Speed</span> <span className="tabular-nums">{Math.round(s.speed * 100)}%</span>
        </Button>
        <Popover open={pop === 'speed'} onClose={() => setPop(null)} className="bottom-11 left-0 w-56">
          <div className="grid grid-cols-5 gap-1 p-1">
            {SPEEDS.map((x) => (
              <button key={x} type="button" onClick={() => controller.setSpeed(x)}
                className={cx('h-8 rounded-control text-xs tabular-nums hover:bg-hover', Math.abs(s.speed - x) < 0.001 && 'font-semibold text-accent')}>{Math.round(x * 100)}</button>
            ))}
          </div>
          <div className="px-2"><Slider value={s.speed} min={0.5} max={1.5} step={0.05} onChange={(v) => controller.setSpeed(v)} aria-label="Speed" /></div>
        </Popover>
      </div>

      <div className="relative">
        <Button variant="ghost" icon="loop" active={!!s.loop} onClick={() => setPop(pop === 'loop' ? null : 'loop')} title="Loop (drag across bars in the tab)">
          {s.loop ? (s.loopCount ? `×${s.loopCount}` : 'On') : <span className="max-md:hidden">Loop</span>}
        </Button>
        <Popover open={pop === 'loop'} onClose={() => setPop(null)} className="bottom-11 left-0 w-72 p-3">
          {s.loop ? (
            <div className="space-y-1">
              {media && (
                <>
                  <Toggle checked={s.trainer.enabled} onChange={(v) => controller.setTrainer({ enabled: v })} label="Speed trainer" />
                  <Slider label="Step" min={0.01} max={0.1} step={0.01} value={s.trainer.step} format={(v) => `+${Math.round(v * 100)}%`} onChange={(v) => controller.setTrainer({ step: v })} />
                  <Slider label="Every" min={1} max={8} step={1} value={s.trainer.everyLoops} format={(v) => `${v} loops`} onChange={(v) => controller.setTrainer({ everyLoops: v })} />
                  <Slider label="Up to" min={0.5} max={1.5} step={0.05} value={s.trainer.target} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => controller.setTrainer({ target: v })} />
                </>
              )}
              <Button size="sm" onClick={() => { controller.clearLoop(); setPop(null); }}>Clear loop (L)</Button>
            </div>
          ) : <p className="text-ink-2">Drag across bars in the tab to loop them.</p>}
        </Popover>
      </div>

      <IconButton icon="metronome" label="Metronome (M)" active={s.metronome} onClick={() => controller.setMetronome(!s.metronome)} />
      <div className="relative">
        <Button variant="ghost" icon="countIn" active={s.countInBars > 0} onClick={() => setPop(pop === 'count' ? null : 'count')} title="Count-in (C)">
          <span className="max-md:hidden">{s.countInBars ? `${s.countInBars} bar${s.countInBars > 1 ? 's' : ''}` : 'Off'}</span>
        </Button>
        <Popover open={pop === 'count'} onClose={() => setPop(null)} className="bottom-11 left-0">
          <div className="px-2.5 pt-1.5 pb-1 text-xs text-muted">Count-in</div>
          {[0, 1, ...(media ? [2] : [])].map((n) => (
            <MenuItem key={n} active={s.countInBars === n} onClick={() => { controller.setCountIn(n); setPop(null); }}>{n === 0 ? 'Off' : `${n} bar${n > 1 ? 's' : ''}`}</MenuItem>
          ))}
        </Popover>
      </div>

      <span className="flex-1" />
      <div className="flex overflow-hidden rounded-control border border-line max-lg:hidden">
        {VIEWS.map(([v, label]) => (
          <button key={v} type="button" onClick={() => p.onView(v)} aria-pressed={p.view === v}
            className={cx('px-2.5 py-1 text-xs', p.view === v ? 'bg-hover font-semibold text-ink' : 'text-ink-2 hover:text-ink')}>{label}</button>
        ))}
      </div>
      <span className="mx-1.5 h-5 w-px bg-line max-lg:hidden" />
      <IconButton icon="zoomOut" label="Smaller" onClick={() => p.onZoom(Math.max(0.6, +(p.zoom - 0.1).toFixed(1)))} className="max-sm:hidden" />
      <IconButton icon="zoomIn" label="Bigger" onClick={() => p.onZoom(Math.min(2, +(p.zoom + 0.1).toFixed(1)))} className="max-sm:hidden" />
      <span className="mx-1.5 h-5 w-px bg-line max-sm:hidden" />
      {p.onToggleSync && <IconButton icon="sync" label="Sync with the recording" active={p.syncOpen} onClick={p.onToggleSync} />}
      <IconButton icon="mixer" label="Mixer" active={p.mixerOpen} onClick={p.onToggleMixer} />
    </footer>
  );
}
