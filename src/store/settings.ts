import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'system' | 'light' | 'dark';

interface SettingsState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useSettings = create<SettingsState>()(
  persist((set) => ({ theme: 'system', setTheme: (theme) => set({ theme }) }), { name: 'fretline-settings' }),
);

/** Applies the theme to <html> and follows the OS setting when theme = system. */
export function applyTheme(theme: Theme): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && mq.matches));
  update();
  mq.addEventListener('change', update);
  return () => mq.removeEventListener('change', update);
}
