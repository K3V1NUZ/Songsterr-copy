import { useEffect } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { LibraryPage } from '@/features/library/LibraryPage';
import { PlayerPage } from '@/features/player/PlayerPage';
import { applyTheme, useSettings, type Theme } from '@/store/settings';

export function App() {
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  useEffect(() => applyTheme(theme), [theme]);

  return (
    <BrowserRouter>
      <div className="flex h-full flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
          <Link to="/" className="font-semibold">Fretline</Link>
          <span className="flex-1" />
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
            className="h-9 rounded-control border border-line bg-surface px-2 text-sm"
            aria-label="Theme"
          >
            <option value="system">System theme</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<LibraryPage />} />
            <Route path="/song/:id" element={<PlayerPage />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}
