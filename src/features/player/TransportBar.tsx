// Bottom transport: play/pause, timeline scrubber, speed, loop + speed trainer,
// metronome, count-in, mixer. Placeholder styling until the design pass.
import { useState } from 'react';
import { Button, Slider, Toggle } from '@/components/ui';
import type { PlayerController } from './PlayerController';
import { usePlayer } from './playerStore';

export const fmtTime = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const SPEEDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5];

export function TransportBar({ controller, onToggleMixer, mixerOpen }: { controller: PlayerController; onToggleMixer: () => void; mixerOpen: boolean }) {
  const p = usePlayer();
  const [trainerOpen, setTrainerOpen] = useState(false);
  const playing = p.state === 'playing' || p.state === 'counting-in';
  const media = p.mode === 'media';

  return (
    <footer className="relative shrink-0 border-t border-line bg-surface">
      {/* scrubber */}
      <input
        type="range"
        aria-label="Position"
        min={0}
        max={Math.max(1, p.durationMs)}
        step={10}
        value={Math.min(p.positionMs, p.durationMs || 0)}
        onChange={(e) => controller.seek(Number(e.target.value))}
        className="absolute -top-2 left-0 h-4 w-full cursor-pointer accent-accent"
        disabled={!p.ready}
      />
      <div className="flex flex-wrap items-center gap-1 px-3 pt-3 pb-2 sm:gap-2">
        <Button variant="primary" size="icon" className="h-12 w-12 rounded-full" onClick={() => controller.toggle()} disabled={!p.ready} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </Button>
        <div className="min-w-24 px-1 font-mono text-xs text-ink-2 tabular-nums">
          {fmtTime(p.positionMs)} / {fmtTime(p.durationMs)}
          {p.countIn && <div className="font-sans text-sm font-semibold text-accent-ink">Count-in {p.countIn.beat}/{p.countIn.of}</div>}
        </div>

        <label className="flex items-center gap-1 text-sm">
          <span className="sr-only sm:not-sr-only text-ink-2">Speed</span>
          <select value={p.speed} onChange={(e) => controller.setSpeed(Number(e.target.value))} className="h-10 rounded-control border border-line bg-surface px-2" aria-label="Speed">
            {[...new Set([...SPEEDS, p.speed])].sort((a, b) => a - b).map((s) => <option key={s} value={s}>{Math.round(s * 100)}%</option>)}
          </select>
        </label>

        <div className="relative">
          <Button variant="ghost" active={!!p.loop} onClick={() => (p.loop ? controller.clearLoop() : setTrainerOpen((o) => !o))} title="Drag across bars in the tab to loop them">
            Loop{p.loop && p.loopCount > 0 ? ` ×${p.loopCount}` : ''}
          </Button>
          {p.loop && media && (
            <Button variant="ghost" size="sm" onClick={() => setTrainerOpen((o) => !o)} aria-label="Speed trainer">⚙</Button>
          )}
          {trainerOpen && (
            <div className="absolute bottom-14 left-0 z-20 w-72 rounded-panel border border-line bg-surface p-3 shadow-lg">
              {!p.loop && <p className="mb-2 text-sm text-ink-2">Drag across bars in the tab to choose a loop.</p>}
              {media && (
                <>
                  <Toggle checked={p.trainer.enabled} onChange={(v) => controller.setTrainer({ enabled: v })} label="Speed trainer" />
                  <Slider label="Step" min={0.01} max={0.1} step={0.01} value={p.trainer.step} format={(v) => `+${Math.round(v * 100)}%`} onChange={(v) => controller.setTrainer({ step: v })} />
                  <Slider label="Every" min={1} max={8} step={1} value={p.trainer.everyLoops} format={(v) => `${v} loops`} onChange={(v) => controller.setTrainer({ everyLoops: v })} />
                  <Slider label="Up to" min={0.5} max={1.5} step={0.05} value={p.trainer.target} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => controller.setTrainer({ target: v })} />
                </>
              )}
            </div>
          )}
        </div>

        <Button variant="ghost" active={p.metronome} onClick={() => controller.setMetronome(!p.metronome)}>Metronome</Button>
        <label className="flex items-center gap-1 text-sm">
          <span className="sr-only sm:not-sr-only text-ink-2">Count-in</span>
          <select value={p.countInBars} onChange={(e) => controller.setCountIn(Number(e.target.value))} className="h-10 rounded-control border border-line bg-surface px-2" aria-label="Count-in">
            <option value={0}>Off</option>
            <option value={1}>1 bar</option>
            {media && <option value={2}>2 bars</option>}
          </select>
        </label>
        <span className="flex-1" />
        <Button variant="ghost" active={mixerOpen} onClick={onToggleMixer}>Mixer</Button>
      </div>
    </footer>
  );
}
