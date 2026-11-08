import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'system' | 'light' | 'dark';

/** 'auto' = as many bars as fit the width (changes with zoom); a number = always that many. */
export type BarsPerRow = 'auto' | 4;

interface SettingsState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  barsPerRow: BarsPerRow;
  setBarsPerRow: (n: BarsPerRow) => void;
}

export const useSettings = create<SettingsState>()(
  persist((set) => ({
    theme: 'system', setTheme: (theme) => set({ theme }),
    barsPerRow: 'auto', setBarsPerRow: (barsPerRow) => set({ barsPerRow }),
  }), { name: 'fretline-settings' }),
);

/** Applies the theme to <html> and follows the OS setting when theme = system. */
export function applyTheme(theme: Theme): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && mq.matches));
  update();
  mq.addEventListener('change', update);
  return () => mq.removeEventListener('change', update);
}
