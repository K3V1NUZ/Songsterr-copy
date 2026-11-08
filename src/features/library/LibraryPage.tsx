// Minimal library (phase 1 scaffolding). The Songsterr-style list, upload flow
// and design come in phase 4.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui';
import { addSampleSongs, addScoreFile, repo } from '@/app/repo';
import type { Song, SongQuery } from '@/data/types';

export function LibraryPage() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [text, setText] = useState('');
  const [sort, setSort] = useState<NonNullable<SongQuery['sort']>>('recent');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => repo.listSongs({ text, sort }).then(setSongs), [text, sort]);
  useEffect(() => { void refresh(); }, [refresh]);

  const onFile = async (file: File) => {
    setError('');
    try {
      await addScoreFile(file.name, new Uint8Array(await file.arrayBuffer()));
      await refresh();
    } catch (e) {
      setError(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search title, artist, instrument, tag…"
          className="h-10 min-w-0 flex-1 rounded-control border border-line bg-surface px-3 text-sm outline-none focus:border-accent"
          aria-label="Search songs"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="h-10 rounded-control border border-line bg-surface px-2 text-sm"
          aria-label="Sort"
        >
          <option value="recent">Recent</option>
          <option value="title">Title</option>
          <option value="artist">Artist</option>
        </select>
        <Button variant="primary" onClick={() => fileRef.current?.click()}>Add score</Button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".musicxml,.xml,.mxl,.gp,.gp3,.gp4,.gp5,.gpx"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ''; }}
        />
      </div>
      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      {songs.length === 0 && !text ? (
        <div className="py-16 text-center text-ink-2">
          <p className="mb-4">Your library is empty.</p>
          <Button onClick={() => void addSampleSongs().then(refresh)}>Add the two sample songs</Button>
        </div>
      ) : (
        <ul className="divide-y divide-line rounded-panel border border-line bg-surface">
          {songs.map((s) => (
            <li key={s.id}>
              <Link to={`/song/${s.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{s.title}</div>
                  <div className="truncate text-sm text-ink-2">{s.artist || 'Unknown artist'}</div>
                </div>
                <div className="hidden text-xs text-muted sm:block">{s.parts.map((p) => p.name).join(' · ')}</div>
              </Link>
            </li>
          ))}
          {songs.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No songs match “{text}”.</li>}
        </ul>
      )}
    </div>
  );
}
