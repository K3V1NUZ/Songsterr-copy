// App shell: top bar (search, current song, add, settings) + one main view.
// Everything else opens as a side panel.
import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons';
import { IconButton, MenuItem, Popover } from '@/components/ui';
import { EditSongPanel } from '@/features/library/EditSongPanel';
import { HomePage } from '@/features/library/HomePage';
import { LibraryPanel } from '@/features/library/LibraryPanel';
import { PlayerPage } from '@/features/player/PlayerPage';
import { UploadPanel } from '@/features/upload/UploadPanel';
import { applyTheme, useSettings, type Theme } from '@/store/settings';
import { useUi } from '@/store/ui';

function TopBar() {
  const { query, setQuery, openLibrary, left, current, openRight } = useUi();
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const [menu, setMenu] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // "/" focuses search (desktop habit)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement | null)?.closest('input, textarea, select')) { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-3 md:gap-4 md:px-4">
      <button type="button" onClick={() => navigate('/')} className="hidden w-[192px] text-left font-bold tracking-tight md:block">Fretline</button>
      <label className={`flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control border px-2.5 md:w-[360px] md:flex-none ${left ? 'border-accent' : 'border-line'}`}>
        <span className="text-muted"><Icon name="search" /></span>
        <input
          ref={input}
          value={query}
          onChange={(e) => { setQuery(e.target.value); openLibrary(true); }}
          onFocus={() => openLibrary(true)}
          placeholder="Search your songs"
          aria-label="Search your songs"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
        />
        <kbd className="hidden text-xs text-muted md:inline">/</kbd>
      </label>
      {current && (
        <div className="hidden min-w-0 truncate text-ink-2 lg:block">
          <b className="font-semibold text-ink">{current.title}</b>{current.artist && <> — {current.artist}</>}
        </div>
      )}
      <div className="ml-auto flex items-center gap-0.5">
        <IconButton icon="plus" label="Add a song" onClick={() => openRight({ kind: 'upload' })} />
        <div className="relative">
          <IconButton icon="settings" label="Settings" onClick={() => setMenu((m) => !m)} />
          <Popover open={menu} onClose={() => setMenu(false)} className="top-10 right-0">
            <div className="px-2.5 pt-1.5 pb-1 text-xs text-muted">Appearance</div>
            {(['system', 'light', 'dark'] as Theme[]).map((t) => (
              <MenuItem key={t} active={theme === t} onClick={() => { setTheme(t); setMenu(false); }}>
                {t === 'system' ? 'Match system' : t === 'light' ? 'Light' : 'Dark'}
              </MenuItem>
            ))}
          </Popover>
        </div>
      </div>
    </header>
  );
}

function Shell() {
  const theme = useSettings((s) => s.theme);
  useEffect(() => applyTheme(theme), [theme]);
  const { left, right, openLibrary, openRight } = useUi();
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/song/:id" element={<PlayerPage />} />
          </Routes>
        </div>
        {left === 'library' && <LibraryPanel onClose={() => openLibrary(false)} />}
        {right?.kind === 'upload' && <UploadPanel onClose={() => openRight(null)} />}
        {right?.kind === 'edit' && <EditSongPanel songId={right.songId} onClose={() => openRight(null)} />}
      </div>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
