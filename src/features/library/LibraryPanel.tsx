// Library as a side panel (opens from the search field). Instant filtering, sort,
// song cards with parts / tuning / tags / sync status, and a per-song menu.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, cx, IconButton, MenuItem, Popover, SidePanel } from '@/components/ui';
import { repo } from '@/app/repo';
import { exportSongBundle, importSongBundle } from '@/data/bundle';
import type { Song, SongQuery } from '@/data/types';
import { applyFilter, syncLabel, type LibraryFilter } from '@/features/upload/createSong';
import { useUi } from '@/store/ui';

const FILTERS: Array<[LibraryFilter, string]> = [['all', 'All songs'], ['guitar', 'Guitar'], ['bass', 'Bass'], ['drums', 'Drums'], ['needs-sync', 'Needs sync']];
const SORTS: Array<[NonNullable<SongQuery['sort']>, string]> = [['recent', 'Recently changed'], ['title', 'Title'], ['artist', 'Artist']];

export function downloadBytes(bytes: Uint8Array, name: string, type = 'application/zip'): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function bundleName(song: Song): string {
  return `${[song.artist, song.title].filter(Boolean).join(' - ').replace(/[^\w\- ]+/g, '').trim() || 'song'}.fretline.zip`;
}

export function LibraryPanel({ onClose }: { onClose: () => void }) {
  const { query, libraryVersion, songsChanged, openRight, current, setQuery } = useUi();
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [sort, setSort] = useState<NonNullable<SongQuery['sort']>>('recent');
  const [songs, setSongs] = useState<Song[]>([]);
  const [used, setUsed] = useState(0);
  const [menu, setMenu] = useState<string | null>(null);
  const [error, setError] = useState('');
  const importInput = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    void repo.listSongs({ text: query, sort }).then((list) => setSongs(applyFilter(list, filter)));
    void repo.usedBytes().then(setUsed);
  }, [query, sort, filter, libraryVersion]);

  const open = (s: Song) => { navigate(`/song/${s.id}`); onClose(); setQuery(''); };

  const onImport = async (file: File) => {
    setError('');
    try {
      const song = await importSongBundle(repo, new Uint8Array(await file.arrayBuffer()));
      songsChanged();
      open(song);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  return (
    <SidePanel title="Your songs" side="left" width="520px" overlay onClose={onClose}
      footer={
        <div className="flex items-center gap-1 px-2 py-2">
          <Button variant="ghost" icon="plus" className="!text-accent" onClick={() => openRight({ kind: 'upload' })}>Add a song</Button>
          <Button variant="ghost" icon="upload" onClick={() => importInput.current?.click()}>Import</Button>
          <span className="ml-auto pr-2 text-xs text-muted">{(used / 1024 / 1024).toFixed(1)} MB used</span>
          <input ref={importInput} type="file" accept=".zip" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImport(f); e.target.value = ''; }} />
        </div>
      }>
      <div className="flex items-center gap-4 overflow-x-auto border-b border-line px-4 py-2.5 text-[13px] whitespace-nowrap">
        {FILTERS.map(([f, label]) => (
          <button key={f} type="button" onClick={() => setFilter(f)} className={filter === f ? 'font-semibold text-ink' : 'text-ink-2 hover:text-ink'}>{label}</button>
        ))}
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort"
          className="ml-auto bg-transparent text-muted outline-none">
          {SORTS.map(([s, label]) => <option key={s} value={s}>{label}</option>)}
        </select>
      </div>
      {error && <p className="px-4 py-2 text-danger">{error}</p>}
      {songs.length === 0 && (
        <p className="px-4 py-8 text-center text-ink-2">
          {query || filter !== 'all' ? 'No songs match.' : 'No songs yet. Add a score and a recording to get started.'}
        </p>
      )}
      <ul>
        {songs.map((s) => {
          const sync = syncLabel(s);
          return (
            <li key={s.id} className={cx('group relative grid grid-cols-[1fr_auto] gap-x-3 border-b border-line px-4 py-2.5 hover:bg-hover', current?.id === s.id && 'bg-hover')}>
              <button type="button" onClick={() => open(s)} className="min-w-0 text-left">
                <div className="truncate"><span className="font-semibold">{s.title}</span>{s.artist && <span className="text-ink-2"> — {s.artist}</span>}</div>
                <div className="truncate text-xs text-muted">
                  {s.parts.map((p) => p.name).join(', ')}
                  {s.tuning && ` · ${s.tuning}`}
                  {s.tags.length > 0 && ` · ${s.tags.join(', ')}`}
                  {s.difficulty ? ` · ${'●'.repeat(s.difficulty)}${'○'.repeat(5 - s.difficulty)}` : ''}
                </div>
              </button>
              <div className="flex items-start gap-1">
                <span className={cx('pt-0.5 text-xs', sync.tone === 'ok' ? 'text-muted' : sync.tone === 'warn' ? 'text-warn' : 'text-muted')}>{sync.text}</span>
                <div className="relative">
                  <IconButton icon="more" label={`More for ${s.title}`} size="sm" className="-mt-1" onClick={() => setMenu(menu === s.id ? null : s.id)} />
                  <Popover open={menu === s.id} onClose={() => setMenu(null)} className="top-8 right-0">
                    <MenuItem onClick={() => { setMenu(null); open(s); }}>Open</MenuItem>
                    <MenuItem onClick={() => { setMenu(null); openRight({ kind: 'edit', songId: s.id }); }}>Edit details & files</MenuItem>
                    <MenuItem onClick={() => { setMenu(null); void exportSongBundle(repo, s.id).then((b) => downloadBytes(b, bundleName(s))); }}>Export as file</MenuItem>
                    <MenuItem danger onClick={() => {
                      setMenu(null);
                      if (!confirm(`Delete “${s.title}” and its files from this device?`)) return;
                      void repo.deleteSong(s.id).then(() => { songsChanged(); if (current?.id === s.id) navigate('/'); });
                    }}>Delete</MenuItem>
                  </Popover>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </SidePanel>
  );
}
