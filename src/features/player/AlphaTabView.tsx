// Renders a score with alphaTab and exposes the API (cursor, selection, player).
// In 'media' mode alphaTab is driven by our Web Audio engine (external media);
// in 'synth' mode alphaTab plays the score itself (no recording attached).
import { useEffect, useRef } from 'react';
import { AlphaTabApi, LayoutMode, model, NotationElement, PlayerMode, ScrollMode, Settings, StaveProfile } from '@coderline/alphatab';

export type ScoreView = 'tab' | 'tab+score' | 'score';
export type AudioMode = 'media' | 'synth';

export interface AlphaTabViewProps {
  data: Uint8Array;
  trackIndex: number;
  view: ScoreView;
  zoom: number;
  mode: AudioMode;
  /** Element alphaTab scrolls to keep the cursor visible. */
  scrollElement?: HTMLElement | null;
  onApi?: (api: AlphaTabApi | null) => void;
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
const PLAYER_MODE = { media: PlayerMode.EnabledExternalMedia, synth: PlayerMode.EnabledSynthesizer } as const;

export function AlphaTabView({ data, trackIndex, view, zoom, mode, scrollElement, onApi, onScoreLoaded, onError }: AlphaTabViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<AlphaTabApi | null>(null);
  const callbacks = useRef({ onApi, onScoreLoaded, onError });
  callbacks.current = { onApi, onScoreLoaded, onError };

  // one API per mount; settings changes are applied by the effects below
  useEffect(() => {
    if (!host.current) return;
    const settings = new Settings();
    // the Vite plugin copies these to /font and /soundfont (not next to the alphaTab script)
    settings.core.fontDirectory = `${import.meta.env.BASE_URL}font/`;
    settings.core.includeNoteBounds = true;
    settings.display.layoutMode = LayoutMode.Page;
    settings.display.staveProfile = PROFILE[view];
    settings.display.scale = zoom;
    settings.player.soundFont = `${import.meta.env.BASE_URL}soundfont/sonivox.sf2`;
    settings.player.playerMode = PLAYER_MODE[mode];
    settings.player.enableCursor = true;
    settings.player.enableAnimatedBeatCursor = true;
    settings.player.enableElementHighlighting = true;
    settings.player.enableSeekToClick = true;
    settings.player.enablePlaybackRangeSelection = true;
    settings.player.scrollMode = ScrollMode.Continuous;
    // keep some room above the cursor line (and the song header visible at the start)
    settings.player.scrollOffsetY = -140;
    if (scrollElement) settings.player.scrollElement = scrollElement;
    // the page shows its own title/artist header; keep only the music
    for (const el of [NotationElement.ScoreTitle, NotationElement.ScoreSubTitle, NotationElement.ScoreArtist, NotationElement.ScoreAlbum,
      NotationElement.ScoreWords, NotationElement.ScoreMusic, NotationElement.ScoreWordsAndMusic, NotationElement.ScoreCopyright]) {
      settings.notation.elements.set(el, false);
    }
    applyThemeColors(settings);
    const a = new AlphaTabApi(host.current, settings);
    a.scoreLoaded.on((score) => callbacks.current.onScoreLoaded?.(score));
    a.error.on((e) => callbacks.current.onError?.(e.message));
    const themeObserver = new MutationObserver(() => {
      applyThemeColors(a.settings);
      a.updateSettings();
      a.render();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    api.current = a;
    callbacks.current.onApi?.(a);
    return () => {
      themeObserver.disconnect();
      callbacks.current.onApi?.(null);
      a.destroy();
      api.current = null;
    };
  }, [mode, scrollElement]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { api.current?.load(data, [trackIndex]); }, [data, mode, scrollElement]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const a = api.current;
    const track = a?.score?.tracks[trackIndex];
    if (a && track) a.renderTracks([track]);
  }, [trackIndex]);

  useEffect(() => {
    const a = api.current;
    if (!a || !a.score) return;
    a.settings.display.staveProfile = PROFILE[view];
    a.settings.display.scale = zoom;
    a.updateSettings();
    a.render();
  }, [view, zoom]);

  return <div ref={host} className="min-h-[50vh] select-none" />;
}
