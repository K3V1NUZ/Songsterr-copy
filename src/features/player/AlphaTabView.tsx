// Renders a score with alphaTab and exposes the API (cursor, selection, player).
// In 'media' mode alphaTab is driven by our Web Audio engine (external media);
// in 'synth' mode alphaTab plays the score itself (no recording attached).
import { useEffect, useRef } from 'react';
import { AlphaTabApi, importer, LayoutMode, model, NotationElement, PlayerMode, ScrollMode, Settings, StaveProfile, TabRhythmMode } from '@coderline/alphatab';
import { unrollRepeats } from '@/sync/unroll';
import { patchTabStems, setTempoLabels, styleScore } from './alphaTabTweaks';

export type ScoreView = 'tab' | 'tab+score' | 'score';
export type AudioMode = 'media' | 'synth';

export interface AlphaTabViewProps {
  data: Uint8Array;
  trackIndex: number;
  view: ScoreView;
  zoom: number;
  /** 'auto' = as many as fit (changes with zoom), or a fixed number per row. */
  barsPerRow: 'auto' | number;
  mode: AudioMode;
  /** Tempo labels to show above bars instead of the score's own (masterbar index -> BPM text). */
  tempoLabels?: Map<number, string> | null;
  /** Element alphaTab scrolls to keep the cursor visible. */
  scrollElement?: HTMLElement | null;
  onApi?: (api: AlphaTabApi | null) => void;
  onScoreLoaded?: (score: model.Score) => void;
  /**
   * Called before the score is drawn with the play order its repeats were written out in
   * (original bar index for each drawn bar).
   */
  onUnrolled?: (order: number[]) => void;
  /** After every finished render (e.g. once a new zoom is drawn). */
  onRendered?: () => void;
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
  // tuning letters beside the strings: plain UI font instead of italic serif
  const sans = css.getPropertyValue('--font-sans').split(',').map((f) => f.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  r.elementFonts.set(NotationElement.GuitarTuning, model.Font.withFamilyList(sans.length ? sans : ['Arial', 'sans-serif'], 12));
  r.elementFonts.set(NotationElement.BarNumber, model.Font.withFamilyList(sans.length ? sans : ['Arial', 'sans-serif'], 10));
}

/** Zoom 100 % draws the notation this much larger than alphaTab's default (less on phones). */
const baseScale = () => (window.matchMedia('(max-width: 767px)').matches ? 1 : 1.5);

const PROFILE = { tab: StaveProfile.Tab, 'tab+score': StaveProfile.ScoreTab, score: StaveProfile.Score } as const;
// rhythm under the tab only when there is no standard notation showing it already
const RHYTHM = { tab: TabRhythmMode.ShowWithBars, 'tab+score': TabRhythmMode.Hidden, score: TabRhythmMode.Hidden } as const;
const PLAYER_MODE = { media: PlayerMode.EnabledExternalMedia, synth: PlayerMode.EnabledSynthesizer } as const;

export function AlphaTabView({ data, trackIndex, view, zoom, barsPerRow, mode, tempoLabels, scrollElement, onApi, onScoreLoaded, onUnrolled, onRendered, onError }: AlphaTabViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<AlphaTabApi | null>(null);
  const callbacks = useRef({ onApi, onScoreLoaded, onUnrolled, onRendered, onError });
  callbacks.current = { onApi, onScoreLoaded, onUnrolled, onRendered, onError };

  // one API per mount; settings changes are applied by the effects below
  useEffect(() => {
    if (!host.current) return;
    patchTabStems();
    const settings = new Settings();
    // render on the main thread so the engraving tweaks apply (scores here are small)
    settings.core.useWorkers = false;
    // the Vite plugin copies these to /font and /soundfont (not next to the alphaTab script)
    settings.core.fontDirectory = `${import.meta.env.BASE_URL}font/`;
    settings.core.includeNoteBounds = true;
    settings.display.layoutMode = LayoutMode.Page;
    settings.display.staveProfile = PROFILE[view];
    settings.display.scale = zoom * baseScale();
    settings.notation.rhythmMode = RHYTHM[view];
    settings.display.barsPerRow = barsPerRow === 'auto' ? -1 : barsPerRow;
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
      NotationElement.ScoreWords, NotationElement.ScoreMusic, NotationElement.ScoreWordsAndMusic, NotationElement.ScoreCopyright,
      NotationElement.TrackNames]) {
      settings.notation.elements.set(el, false);
    }
    applyThemeColors(settings);
    const a = new AlphaTabApi(host.current, settings);
    a.scoreLoaded.on((score) => { styleScore(score); callbacks.current.onScoreLoaded?.(score); });
    a.error.on((e) => callbacks.current.onError?.(e.message));
    a.renderFinished.on(() => callbacks.current.onRendered?.());
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

  // tempo labels: compare by content so a new Map with the same labels doesn't re-render
  const labelsKey = tempoLabels ? JSON.stringify([...tempoLabels]) : '';
  const firstLabels = useRef(true);
  useEffect(() => {
    setTempoLabels(tempoLabels ?? null);
    if (firstLabels.current) { firstLabels.current = false; return; }
    if (api.current?.score) api.current.render();
  }, [labelsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // repeats are written out: every played bar is drawn in play order (see sync/unroll.ts)
  useEffect(() => {
    const a = api.current;
    if (!a) return;
    try {
      const { score, order } = unrollRepeats(importer.ScoreLoader.loadScoreFromBytes(data, a.settings), a.settings);
      callbacks.current.onUnrolled?.(order);
      a.renderScore(score, [trackIndex]);
    } catch (e) {
      callbacks.current.onError?.(`Could not read the score: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [data, mode, scrollElement]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const a = api.current;
    const track = a?.score?.tracks[trackIndex];
    if (a && track) a.renderTracks([track]);
  }, [trackIndex]);

  useEffect(() => {
    const a = api.current;
    if (!a || !a.score) return;
    a.settings.display.staveProfile = PROFILE[view];
    a.settings.display.scale = zoom * baseScale();
    a.settings.notation.rhythmMode = RHYTHM[view];
    a.settings.display.barsPerRow = barsPerRow === 'auto' ? -1 : barsPerRow;
    a.updateSettings();
    a.render();
  }, [view, zoom, barsPerRow]);

  return <div ref={host} className="min-h-[50vh] select-none" />;
}
