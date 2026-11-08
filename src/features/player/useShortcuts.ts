// Desktop keyboard shortcuts (set "b" agreed with the user):
//   Space play/pause · L clear loop · ←/→ previous/next bar · M metronome
//   + / − speed ±5 % · C count-in on/off · T next track · Home back to start · 1–9 track 1–9
import { useEffect, useRef } from 'react';
import type { PlayerController } from './PlayerController';
import { usePlayer } from './playerStore';

export interface ShortcutActions {
  trackCount: number;
  selectTrack: (index: number) => void;
  nextTrack: () => void;
}

export const SHORTCUTS: Array<[string, string]> = [
  ['Space', 'Play / pause'], ['L', 'Clear loop'], ['← / →', 'Previous / next bar'], ['M', 'Metronome'],
  ['+ / −', 'Speed ±5 %'], ['C', 'Count-in on/off'], ['T', 'Next track'], ['Home', 'Back to start'], ['1–9', 'Track 1–9'],
];

export function useShortcuts(controller: PlayerController | undefined, actions: ShortcutActions): void {
  const acts = useRef(actions);
  acts.current = actions;
  useEffect(() => {
    if (!controller) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const p = usePlayer.getState();
      const a = acts.current;
      let handled = true;
      switch (e.key) {
        case ' ': controller.toggle(); break;
        case 'l': case 'L': if (p.loop) controller.clearLoop(); break;
        case 'ArrowRight': controller.seekBars(1); break;
        case 'ArrowLeft': controller.seekBars(-1); break;
        case 'm': case 'M': controller.setMetronome(!p.metronome); break;
        case '+': case '=': controller.setSpeed(p.speed + 0.05); break;
        case '-': case '_': controller.setSpeed(p.speed - 0.05); break;
        case 'c': case 'C': controller.setCountIn(p.countInBars > 0 ? 0 : 1); break;
        case 't': case 'T': a.nextTrack(); break;
        case 'Home': controller.seek(0); break;
        default:
          if (/^[1-9]$/.test(e.key) && Number(e.key) <= a.trackCount) a.selectTrack(Number(e.key) - 1);
          else handled = false;
      }
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);
}
