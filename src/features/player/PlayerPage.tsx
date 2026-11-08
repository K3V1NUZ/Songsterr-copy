// Minimal player page (phase 1 scaffolding): track list + alphaTab rendering.
// Transport, audio engine, mixer etc. come in phase 2.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, TrackItem } from '@/components/ui';
import { repo } from '@/app/repo';
import type { Song } from '@/data/types';
import { AlphaTabView } from './AlphaTabView';

export function PlayerPage() {
  const { id = '' } = useParams();
  const [song, setSong] = useState<Song>();
  const [data, setData] = useState<Uint8Array>();
  const [trackIndex, setTrackIndex] = useState(0);
  const [view, setView] = useState<'tab' | 'tab+score' | 'score'>('tab');
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await repo.getSong(id);
      if (!s) return setError('Song not found');
      const file = await repo.getFile(s.scoreFileId);
      if (!file?.blob) return setError('The score file is missing');
      const bytes = new Uint8Array(await file.blob.arrayBuffer());
      if (!cancelled) { setSong(s); setData(bytes); }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (error) return <p className="p-6 text-danger">{error} — <Link className="underline" to="/">back to library</Link></p>;
  if (!song || !data) return <p className="p-6 text-muted">Loading…</p>;

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="shrink-0 border-b border-line p-3 md:w-64 md:border-r md:border-b-0">
        <h1 className="px-3 text-lg font-semibold">{song.title}</h1>
        <p className="mb-3 px-3 text-sm text-ink-2">{song.artist}</p>
        <div className="flex gap-1 overflow-x-auto md:flex-col">
          {song.parts.map((p) => (
            <TrackItem key={p.id} name={p.name} detail={[p.instrument, p.tuning].filter(Boolean).join(' · ')}
              selected={p.trackIndex === trackIndex} onSelect={() => setTrackIndex(p.trackIndex)} />
          ))}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">
        <div className="sticky top-0 z-10 flex flex-wrap gap-1 border-b border-line bg-bg/90 p-2 backdrop-blur">
          {(['tab', 'tab+score', 'score'] as const).map((v) => (
            <Button key={v} size="sm" variant="ghost" active={view === v} onClick={() => setView(v)}>
              {v === 'tab' ? 'Tab' : v === 'score' ? 'Notation' : 'Tab + notation'}
            </Button>
          ))}
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(1)))} aria-label="Smaller">−</Button>
          <span className="self-center font-mono text-xs text-ink-2">{Math.round(zoom * 100)}%</span>
          <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(1)))} aria-label="Bigger">+</Button>
        </div>
        <AlphaTabView data={data} trackIndex={trackIndex} view={view} zoom={zoom} onError={setError} />
      </main>
    </div>
  );
}
