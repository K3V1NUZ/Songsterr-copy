// App shell: top bar (search, current song, add, settings) + one main view.
// Everything else opens as a side panel (or, for the song list, a window in the middle).
import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { IconButton, MenuItem, Popover } from '@/components/ui';
import { EditSongPanel } from '@/features/library/EditSongPanel';
import { HomePage } from '@/features/library/HomePage';
import { LibraryPanel } from '@/features/library/LibraryPanel';
import { SearchBox } from '@/features/library/SearchBox';
import { PlayerPage } from '@/features/player/PlayerPage';
import { UploadPanel } from '@/features/upload/UploadPanel';
import { applyTheme, useSettings, type BarsPerRow, type TabWidth, type Theme } from '@/store/settings';
import { useUi } from '@/store/ui';

function TopBar() {
  const { openRight } = useUi();
  const { theme, setTheme, barsPerRow, setBarsPerRow, tabWidth, setTabWidth } = useSettings();
  const [menu, setMenu] = useState(false);
  const navigate = useNavigate();

  return (
    <header className="grid shrink-0 grid-cols-[1fr_minmax(0,440px)_1fr] items-center gap-3 border-b border-line px-3 py-2 md:px-4">
      <button type="button" onClick={() => navigate('/')} className="hidden justify-self-start font-bold tracking-tight md:block">Fretline</button>
      <div className="col-start-2 flex min-w-0 justify-center max-md:col-span-2 max-md:col-start-1">
        <SearchBox />
      </div>
      <div className="col-start-3 flex items-center gap-0.5 justify-self-end">
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
            <div className="mt-1 border-t border-line px-2.5 pt-2 pb-1 text-xs text-muted">Tab width</div>
            {([['full', 'Full width'], ['compact', 'Compact (centered)']] as Array<[TabWidth, string]>).map(([v, label]) => (
              <MenuItem key={v} active={tabWidth === v} onClick={() => { setTabWidth(v); setMenu(false); }}>{label}</MenuItem>
            ))}
            <div className="mt-1 border-t border-line px-2.5 pt-2 pb-1 text-xs text-muted">Bars per row</div>
            {([['auto', 'Fit to width (follows zoom)'], [4, 'Always 4']] as Array<[BarsPerRow, string]>).map(([v, label]) => (
              <MenuItem key={v} active={barsPerRow === v} onClick={() => { setBarsPerRow(v); setMenu(false); }}>{label}</MenuItem>
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
