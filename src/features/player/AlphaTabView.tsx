// Renders a score with alphaTab. Playback is added in phase 2 (external-media mode
// driven by our own Web Audio engine).
import { useEffect, useRef } from 'react';
import { AlphaTabApi, LayoutMode, model, Settings, StaveProfile } from '@coderline/alphatab';

export interface AlphaTabViewProps {
  data: Uint8Array;
  trackIndex: number;
  view: 'tab' | 'tab+score' | 'score';
  zoom: number;
  onScoreLoaded?: (score: model.Score) => void;
  onError?: (message: string) => void;
}

/** Copies the theme's design tokens into alphaTab's colours (notation is drawn, not styled by CSS). */
function applyThemeColors(settings: Settings): void {
  const css = getComputedStyle(document.documentElement);
  const color = (name: string) => model.Color.fromJson(css.getPropertyValue(name).trim() || '#000000')!;
  const r = settings.display.resources;
  r.mainGlyphColor = color('--c-ink');
  r.secondaryGlyphColor = color('--c-ink-2');
  r.scoreInfoColor = color('--c-ink');
  r.staffLineColor = color('--c-line');
  r.barSeparatorColor = color('--c-ink-2');
  r.barNumberColor = color('--c-muted');
}

const PROFILE = { tab: StaveProfile.Tab, 'tab+score': StaveProfile.ScoreTab, score: StaveProfile.Score } as const;

export function AlphaTabView({ data, trackIndex, view, zoom, onScoreLoaded, onError }: AlphaTabViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<AlphaTabApi | null>(null);
  const callbacks = useRef({ onScoreLoaded, onError });
  callbacks.current = { onScoreLoaded, onError };

  // create the API once per mount
  useEffect(() => {
    if (!host.current) return;
    const settings = new Settings();
    // the Vite plugin copies these to /font and /soundfont (not next to the alphaTab script)
    settings.core.fontDirectory = `${import.meta.env.BASE_URL}font/`;
    settings.player.soundFont = `${import.meta.env.BASE_URL}soundfont/sonivox.sf2`;
    settings.display.layoutMode = LayoutMode.Page;
    settings.display.staveProfile = PROFILE[view];
    settings.display.scale = zoom;
    settings.core.includeNoteBounds = true;
    applyThemeColors(settings);
    const a = new AlphaTabApi(host.current, settings);
    // re-colour when the theme (the `dark` class on <html>) changes
    const themeObserver = new MutationObserver(() => {
      applyThemeColors(a.settings);
      a.updateSettings();
      a.render();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    a.scoreLoaded.on((score) => callbacks.current.onScoreLoaded?.(score));
    a.error.on((e) => callbacks.current.onError?.(e.message));
    api.current = a;
    return () => { themeObserver.disconnect(); a.destroy(); api.current = null; };
    // settings changes are applied by the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { api.current?.load(data, [trackIndex]); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const a = api.current;
    const track = a?.score?.tracks[trackIndex];
    if (a && track) a.renderTracks([track]);
  }, [trackIndex]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    a.settings.display.staveProfile = PROFILE[view];
    a.settings.display.scale = zoom;
    a.updateSettings();
    a.render();
  }, [view, zoom]);

  return <div ref={host} className="min-h-[50vh]" />;
}
