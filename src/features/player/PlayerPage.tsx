// Player: track list (left), tab (centre), transport (bottom), mixer panel.
// Placeholder styling until the design pass (phase 4).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlphaTabApi } from '@coderline/alphatab';
import { Link, useParams } from 'react-router-dom';
import { Panel, TrackItem } from '@/components/ui';
import { repo } from '@/app/repo';
import { newId } from '@/data/SongRepository';
import type { Song } from '@/data/types';
import { AlphaTabView, type ScoreView } from './AlphaTabView';
import { MixerPanel } from './MixerPanel';
import { PlayerController } from './PlayerController';
import { TransportBar } from './TransportBar';
import { usePlayer } from './playerStore';
import { useShortcuts } from './useShortcuts';

export function PlayerPage() {
  const { id = '' } = useParams();
  const [song, setSong] = useState<Song>();
  const [data, setData] = useState<Uint8Array>();
  const [trackIndex, setTrackIndex] = useState(0);
  const [view, setView] = useState<ScoreView>('tab');
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');
  const [controller, setController] = useState<PlayerController>();
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [mixerOpen, setMixerOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickFor = useRef<'recording' | 'stem'>('recording');
  const playerError = usePlayer((s) => s.error);

  // load song + score bytes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await repo.getSong(id);
      if (!s) return setError('Song not found');
      const file = await repo.getFile(s.scoreFileId);
      if (!file?.blob) return setError('The score file is missing');
      const bytes = new Uint8Array(await file.blob.arrayBuffer());
      const settings = await repo.getSettings(s.id);
      if (cancelled) return;
      setSong(s);
      setData(bytes);
      if (settings) { setTrackIndex(settings.trackIndex); setView(settings.view); setZoom(settings.zoom); }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const mode = song?.audioFileId ? 'media' : 'synth';

  // one controller per song + mode; audio files are loaded into it
  useEffect(() => {
    if (!song) return;
    const c = new PlayerController(mode, song.syncPoints);
    setController(c);
    (async () => {
      if (song.audioFileId) {
        const f = await repo.getFile(song.audioFileId);
        if (f?.blob) await c.setRecording(f.blob);
      }
      for (const st of song.stems) {
        const f = await repo.getFile(st.fileId);
        if (f?.blob) await c.addStem(st.id, f.blob);
      }
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => c.destroy();
  }, [song?.id, song?.audioFileId, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // restore this song's mixer + speed into a new controller
  useEffect(() => {
    if (!song || !controller) return;
    let cancelled = false;
    void repo.getSettings(song.id).then((st) => {
      if (cancelled || !st) return;
      for (const [ch, v] of Object.entries(st.volumes)) controller.setVolume(ch, v);
      st.muted.forEach((ch) => controller.setMuted(ch, true));
      st.solo.forEach((ch) => controller.setSolo(ch, true));
      if (st.speed !== 1) controller.setSpeed(st.speed);
    });
    return () => { cancelled = true; };
  }, [controller]); // eslint-disable-line react-hooks/exhaustive-deps

  // remember view, mixer and speed per song
  const channels = usePlayer((s) => s.channels);
  const speed = usePlayer((s) => s.speed);
  useEffect(() => {
    if (!song) return;
    const t = setTimeout(() => {
      const entries = Object.entries(channels);
      void repo.saveSettings({
        songId: song.id, trackIndex, view, zoom, speed,
        volumes: Object.fromEntries(entries.map(([k, c]) => [k, c.volume])),
        muted: entries.filter(([, c]) => c.muted).map(([k]) => k),
        solo: entries.filter(([, c]) => c.solo).map(([k]) => k),
      });
    }, 400);
    return () => clearTimeout(t);
  }, [song, trackIndex, view, zoom, channels, speed]);

  // dev-only hook for browser tests
  useEffect(() => {
    if (import.meta.env.DEV && controller) Object.assign(window, { __fretline: { controller, repo, song } });
  }, [controller, song]);

  // the alphaTab API and the controller can each be re-created (e.g. when a recording is
  // attached the mode changes); connect whichever pair is current
  const [api, setApi] = useState<AlphaTabApi | null>(null);
  useEffect(() => {
    if (!controller) return;
    controller.attach(api);
    return () => controller.attach(null);
  }, [controller, api]);
  const onApi = useCallback((a: AlphaTabApi | null) => setApi(a), []);
  useShortcuts(controller, {
    trackCount: song?.parts.length ?? 0,
    selectTrack: (i) => { const part = song?.parts[i]; if (part) setTrackIndex(part.trackIndex); },
    nextTrack: () => {
      if (!song?.parts.length) return;
      const k = song.parts.findIndex((p) => p.trackIndex === trackIndex);
      setTrackIndex(song.parts[(k + 1) % song.parts.length]!.trackIndex);
    },
  });

  const onPickFile = async (file: File) => {
    if (!song || !controller) return;
    const kind = pickFor.current;
    const stored = await repo.putFile({ kind: kind === 'recording' ? 'audio' : 'stem', name: file.name, blob: file });
    if (kind === 'recording') {
      setSong(await repo.updateSong(song.id, { audioFileId: stored.id }));
    } else {
      const part = song.parts.find((p) => p.trackIndex === trackIndex);
      const stem = { id: newId(), name: file.name.replace(/\.[^.]+$/, ''), fileId: stored.id, ...(part ? { partId: part.id } : {}) };
      const next = await repo.updateSong(song.id, { stems: [...song.stems, stem] });
      setSong(next);
      await controller.addStem(stem.id, file);
    }
  };

  if (error) return <p className="p-6 text-danger">{error} — <Link className="underline" to="/">back to library</Link></p>;
  if (!song || !data || !controller) return <p className="p-6 text-muted">Loading…</p>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="shrink-0 border-b border-line p-3 md:w-64 md:overflow-auto md:border-r md:border-b-0">
          <h1 className="px-3 text-lg font-semibold">{song.title}</h1>
          <p className="mb-3 px-3 text-sm text-ink-2">{song.artist}</p>
          <div className="flex gap-1 overflow-x-auto md:flex-col">
            {song.parts.map((p) => (
              <TrackItem key={p.id} name={p.name}
                detail={[p.instrument, p.tuning, song.stems.some((s) => s.partId === p.id) ? 'stem' : ''].filter(Boolean).join(' · ')}
                selected={p.trackIndex === trackIndex} onSelect={() => setTrackIndex(p.trackIndex)} />
            ))}
          </div>
        </aside>
        <main ref={setScrollEl} className="relative min-w-0 flex-1 overflow-auto">
          <div className="sticky top-0 z-10 flex flex-wrap gap-1 border-b border-line bg-bg/90 p-2 backdrop-blur">
            {(['tab', 'tab+score', 'score'] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)}
                className={`h-8 rounded-control px-3 text-sm ${view === v ? 'bg-accent-soft text-accent-ink' : 'text-ink-2 hover:bg-surface-2'}`}>
                {v === 'tab' ? 'Tab' : v === 'score' ? 'Notation' : 'Tab + notation'}
              </button>
            ))}
            <span className="flex-1" />
            <button type="button" className="h-8 w-8 rounded-control text-ink-2 hover:bg-surface-2" onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(1)))} aria-label="Smaller">−</button>
            <span className="self-center font-mono text-xs text-ink-2">{Math.round(zoom * 100)}%</span>
            <button type="button" className="h-8 w-8 rounded-control text-ink-2 hover:bg-surface-2" onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(1)))} aria-label="Bigger">+</button>
          </div>
          {playerError && <p className="px-4 py-2 text-sm text-danger">{playerError}</p>}
          {scrollEl && (
            <AlphaTabView data={data} trackIndex={trackIndex} view={view} zoom={zoom} mode={mode} scrollElement={scrollEl} onApi={onApi} onError={setError} />
          )}
        </main>
        {mixerOpen && (
          <aside className="shrink-0 border-t border-line p-3 md:w-72 md:overflow-auto md:border-t-0 md:border-l">
            <Panel title="Mixer">
              <MixerPanel song={song} controller={controller}
                onAttachRecording={() => { pickFor.current = 'recording'; fileInput.current?.click(); }}
                onAddStem={() => { pickFor.current = 'stem'; fileInput.current?.click(); }} />
            </Panel>
          </aside>
        )}
      </div>
      <TransportBar controller={controller} mixerOpen={mixerOpen} onToggleMixer={() => setMixerOpen((o) => !o)} />
      <input ref={fileInput} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPickFile(f); e.target.value = ''; }} />
    </div>
  );
}
