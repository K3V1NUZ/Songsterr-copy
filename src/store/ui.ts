// App-wide UI state: which side panel is open, the search text, the current song.
import { create } from 'zustand';
import type { Id, Song } from '@/data/types';

export type LeftPanel = 'library' | null;
export type RightPanel = { kind: 'upload' } | { kind: 'edit'; songId: Id } | null;

interface UiState {
  query: string;
  left: LeftPanel;
  right: RightPanel;
  /** Song shown in the player (for the top bar). */
  current: Song | null;
  /** Bumped when songs change, so lists reload. */
  libraryVersion: number;
  /** Bumped to ask the search field to take focus. */
  searchFocus: number;
  focusSearch: () => void;
  setQuery: (q: string) => void;
  openLibrary: (open?: boolean) => void;
  openRight: (p: RightPanel) => void;
  setCurrent: (s: Song | null) => void;
  songsChanged: () => void;
}

export const useUi = create<UiState>()((set) => ({
  query: '',
  left: null,
  right: null,
  current: null,
  libraryVersion: 0,
  searchFocus: 0,
  focusSearch: () => set((s) => ({ searchFocus: s.searchFocus + 1 })),
  setQuery: (query) => set({ query }),
  openLibrary: (open = true) => set({ left: open ? 'library' : null }),
  openRight: (right) => set({ right }),
  setCurrent: (current) => set({ current }),
  songsChanged: () => set((s) => ({ libraryVersion: s.libraryVersion + 1 })),
}));
