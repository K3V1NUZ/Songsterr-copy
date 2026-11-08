// Player (design A2): instruments panel left, the tab in the middle (the only thing
// that scrolls), mixer as a right panel, sync tool as a bottom drawer, bottom bar.
import { useCallback, useEffect, useState } from 'react';
import type { AlphaTabApi } from '@coderline/alphatab';
import { Link, useLocation, useParams } from 'react-router-dom';
import { instrumentIcon } from '@/components/icons';
import { cx, TrackItem } from '@/components/ui';
import { repo } from '@/app/repo';
import type { Song } from '@/data/types';
import { SyncPanel } from '@/features/sync/SyncPanel';
import { useUi } from '@/store/ui';
import { AlphaTabView, type ScoreView } from './AlphaTabView';
import { BottomBar } from './BottomBar';
import { MixerPanel } from './MixerPanel';
import { PlayerController } from './PlayerController';
import { usePlayer } from './playerStore';
import { useShortcuts } from './useShortcuts';

const isPhone = () => window.matchMedia('(max-width: 767px)').matches;

export function PlayerPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const { current: song, setCurrent, openRight } = useUi();
  const [data, setData] = useState<{ fileId: string; bytes: Uint8Array }>();
  const [trackIndex, setTrackIndex] = useState(0);
  const [view, setView] = useState<ScoreView>('tab');
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');
  const [controller, setController] = useState<PlayerController>();
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [tracksOpen, setTracksOpen] = useState(false);
  const [sync, setSync] = useState<{ open: boolean; autoRun: boolean }>({ open: false, autoRun: false });
  const [recording, setRecording] = useState<Blob | null>(null);
  const [api, setApi] = useState<AlphaTabApi | null>(null);
  const [partState, setPartState] = useState<Record<number, { muted?: boolean; solo?: boolean }>>({});
  const playerError = usePlayer((s) => s.error);
  const positionMs = usePlayer((s) => s.positionMs);
  usePlayer((s) => s.scoreVersion);

  // load the song (and its view settings); the song object lives in the UI store so
  // edits made in the edit panel show up here too
  useEffect(() => {
    let cancelled = false;
    setError('');
    void (async () => {
      const s = await repo.getSong(id);
      if (cancelled) return;
      if (!s) { setError('Song not found'); return; }
      const st = await repo.getSettings(s.id);
      if (st) { setTrackIndex(st.trackIndex); setView(st.view); setZoom(st.zoom); }
      setCurrent(s);
    })();
    return () => { cancelled = true; };
  }, [id, setCurrent]);

  const active = song && song.id === id ? song : undefined;

  // score bytes (reload when the score file is replaced)
  useEffect(() => {
    if (!active) return;
    if (data?.fileId === active.scoreFileId) return;
    let cancelled = false;
    void repo.getFile(active.scoreFileId).then(async (f) => {
      if (!f?.blob) { setError('The score file is missing'); return; }
      const bytes = new Uint8Array(await f.blob.arrayBuffer());
      if (!cancelled) setData({ fileId: active.scoreFileId, bytes });
    });
    return () => { cancelled = true; };
  }, [active, data?.fileId]);

  const mode = active?.audioFileId ? 'media' : 'synth';

  // one controller per song + recording; audio files are loaded into it
  useEffect(() => {
    if (!active) return;
    const c = new PlayerController(mode, active.syncPoints);
    setController(c);
    setPartState({});
    void (async () => {
      if (active.audioFileId) {
        const f = await repo.getFile(active.audioFileId);
        setRecording(f?.blob ?? null);
        if (f?.blob) await c.setRecording(f.blob);
      } else setRecording(null);
      for (const st of active.stems) {
        const f = await repo.getFile(st.fileId);
        if (f?.blob) await c.addStem(st.id, f.blob);
      }
      const saved = await repo.getSettings(active.id);
      if (saved) {
        for (const [ch, v] of Object.entries(saved.volumes)) c.setVolume(ch, v);
        saved.muted.forEach((ch) => c.setMuted(ch, true));
        saved.solo.forEach((ch) => c.setSolo(ch, true));
        if (saved.speed !== 1) c.setSpeed(saved.speed);
      }
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => c.destroy();
  }, [active?.id, active?.audioFileId, active?.stems.length, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!controller) return;
    controller.attach(api);
    return () => controller.attach(null);
  }, [controller, api]);
  const onApi = useCallback((a: AlphaTabApi | null) => setApi(a), []);

  // a new upload with a recording: run auto-sync straight away
  useEffect(() => {
    const st = location.state as { autoSync?: boolean } | null;
    if (st?.autoSync && mode === 'media') { setSync({ open: true, autoRun: true }); window.history.replaceState({}, ''); }
  }, [location.state, mode]);

  // remember view, mixer and speed per song
  const channels = usePlayer((s) => s.channels);
  const speed = usePlayer((s) => s.speed);
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      const entries = Object.entries(channels);
      void repo.saveSettings({
        songId: active.id, trackIndex, view, zoom, speed,
        volumes: Object.fromEntries(entries.map(([k, c]) => [k, c.volume])),
        muted: entries.filter(([, c]) => c.muted).map(([k]) => k),
        solo: entries.filter(([, c]) => c.solo).map(([k]) => k),
      });
    }, 400);
    return () => clearTimeout(t);
  }, [active, trackIndex, view, zoom, channels, speed]);

  useShortcuts(controller, {
    trackCount: active?.parts.length ?? 0,
    selectTrack: (i) => { const part = active?.parts[i]; if (part) setTrackIndex(part.trackIndex); },
    nextTrack: () => {
      if (!active?.parts.length) return;
      const k = active.parts.findIndex((p) => p.trackIndex === trackIndex);
      setTrackIndex(active.parts[(k + 1) % active.parts.length]!.trackIndex);
    },
  });

  if (error) return <p className="p-6 text-danger">{error} — <Link className="underline" to="/">back</Link></p>;
  if (!active || !data || !controller) return <p className="p-6 text-muted">Loading…</p>;

  const part = active.parts.find((p) => p.trackIndex === trackIndex);
  const loc = controller.locate(positionMs);
  const barLabel = loc ? `bar ${loc.barIndex + 1}` : '';
  const stemIdsOf = (partId: string) => active.stems.filter((s) => s.partId === partId).map((s) => s.id);
  const partToggle = (trackIdx: number, partId: string, key: 'muted' | 'solo') => {
    const ids = stemIdsOf(partId);
    if (mode === 'media' && !ids.length) return undefined; // nothing to mute: the part is inside the recording
    return () => {
      const next = !partState[trackIdx]?.[key];
      setPartState((ps) => ({ ...ps, [trackIdx]: { ...ps[trackIdx], [key]: next } }));
      if (key === 'muted') controller.setPartMuted(trackIdx, next, ids); else controller.setPartSolo(trackIdx, next, ids);
    };
  };
  const syncText = active.syncSource === 'auto' ? `Synced automatically (${Math.round((active.syncConfidence ?? 0) * 100)} %)`
    : active.syncSource === 'manual' ? 'Synced by hand' : 'Not synced yet';

  return (
    <>
      <div className="relative flex min-h-0 flex-1">
        {/* instruments: hidden until opened from the bottom bar; docked on desktop, sliding in on phones */}
        <aside className={cx('z-20 w-56 shrink-0 overflow-y-auto border-r border-line bg-surface py-2',
          'max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:shadow-xl', !tracksOpen && 'hidden')}>
          {active.parts.map((p) => (
            <TrackItem key={p.id} name={p.name} icon={instrumentIcon(p.instrument)}
              detail={[p.instrument, p.tuning].filter(Boolean).join(' · ')}
              selected={p.trackIndex === trackIndex}
              muted={partState[p.trackIndex]?.muted} solo={partState[p.trackIndex]?.solo}
              onSelect={() => { setTrackIndex(p.trackIndex); if (isPhone()) setTracksOpen(false); }}
              onToggleMute={partToggle(p.trackIndex, p.id, 'muted')} onToggleSolo={partToggle(p.trackIndex, p.id, 'solo')} />
          ))}
        </aside>

        {/* the tab — the only thing that scrolls */}
        <main ref={setScrollEl} className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1200px] px-4 pt-6 md:px-10">
            <h1 className="text-[22px] leading-tight font-semibold">{active.title}</h1>
            {active.artist && <p className="text-ink-2">{active.artist}</p>}
            <div className="mt-2 mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              <span>♩ = {Math.round(active.bpm)}</span>
              {part && <span>{part.name}{part.tuning ? ` · ${part.tuning}` : ''}</span>}
              {mode === 'media' ? (
                <span>{syncText} · <button type="button" className="text-accent hover:underline" onClick={() => setSync({ open: true, autoRun: active.syncSource === 'none' })}>
                  {active.syncSource === 'none' ? 'sync it' : 'fix sync'}</button></span>
              ) : (
                <span>No recording · <button type="button" className="text-accent hover:underline" onClick={() => openRight({ kind: 'edit', songId: active.id })}>add one</button></span>
              )}
            </div>
            {playerError && <p className="text-danger">{playerError}</p>}
          </div>
          {scrollEl && (
            <div className="mx-auto max-w-[1200px] px-2 pb-24 md:px-6">
              <AlphaTabView data={data.bytes} trackIndex={trackIndex} view={view} zoom={zoom} mode={mode} scrollElement={scrollEl} onApi={onApi} onError={setError} />
            </div>
          )}
        </main>

        {mixerOpen && <MixerPanel song={active} controller={controller} onClose={() => setMixerOpen(false)} onEditFiles={() => openRight({ kind: 'edit', songId: active.id })} />}
      </div>

      {sync.open && mode === 'media' && (
        <SyncPanel song={active} controller={controller} recording={recording} autoRun={sync.autoRun}
          onSongChange={(s: Song) => setCurrent(s)}
          onAutoDone={(confidence) => { if (confidence >= 0.6 && sync.autoRun) setSync({ open: false, autoRun: false }); }}
          onClose={() => setSync({ open: false, autoRun: false })} />
      )}
      <BottomBar tracksOpen={tracksOpen} controller={controller} view={view} onView={setView} zoom={zoom} onZoom={setZoom}
        mixerOpen={mixerOpen} onToggleMixer={() => setMixerOpen((o) => !o)}
        syncOpen={sync.open} onToggleSync={mode === 'media' ? () => setSync((s) => ({ open: !s.open, autoRun: false })) : undefined}
        onToggleTracks={() => setTracksOpen((o) => !o)} barLabel={barLabel} />
    </>
  );
}
