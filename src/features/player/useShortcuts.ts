// Desktop keyboard shortcuts. Only Space and L for now (from the brief);
// the full set is proposed to the user before it's finalized.
import { useEffect } from 'react';
import type { PlayerController } from './PlayerController';
import { usePlayer } from './playerStore';

export function useShortcuts(controller: PlayerController | undefined): void {
  useEffect(() => {
    if (!controller) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space') { e.preventDefault(); controller.toggle(); }
      else if (e.key === 'l' || e.key === 'L') { if (usePlayer.getState().loop) controller.clearLoop(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);
}
