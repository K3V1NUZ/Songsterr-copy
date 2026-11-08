// Zoom the tab with a pinch (touch screens, trackpads) or Ctrl/⌘ + mouse wheel.
// While the gesture runs the tab is scaled with CSS for instant feedback; when it ends the zoom
// is committed and alphaTab re-lays out the bars (more or fewer per row).
import { useEffect, useRef } from 'react';

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.5;
export const clampZoom = (z: number) => Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 20) / 20;

const COMMIT_DELAY_MS = 220;

export function usePinchZoom(scrollEl: HTMLElement | null, zoom: number, setZoom: (z: number) => void) {
  const target = useRef<HTMLDivElement>(null);
  const state = useRef({ zoom, setZoom });
  state.current = { zoom, setZoom };
  const waiting = useRef(false); // a zoom was committed and alphaTab hasn't drawn it yet

  const onRendered = () => {
    if (!waiting.current) return;
    waiting.current = false;
    if (target.current) target.current.style.transform = '';
  };

  useEffect(() => {
    if (!scrollEl) return;
    let pending: number | null = null;
    let timer = 0;
    let pinch: { dist: number; base: number } | null = null;

    const preview = (z: number) => {
      pending = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
      const el = target.current;
      if (el) el.style.transform = `scale(${pending / state.current.zoom})`;
    };
    const commit = () => {
      clearTimeout(timer);
      if (pending === null) return;
      const z = clampZoom(pending);
      pending = null;
      waiting.current = true;
      // keep the CSS scale until alphaTab has re-rendered at the new size (see onRendered)
      if (z !== state.current.zoom) state.current.setZoom(z);
      else onRendered();
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // trackpad pinch arrives as ctrl + wheel
      e.preventDefault();
      preview((pending ?? state.current.zoom) * Math.exp(-e.deltaY * 0.01));
      clearTimeout(timer);
      timer = window.setTimeout(commit, COMMIT_DELAY_MS);
    };
    const dist = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY) || 1;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch = { dist: dist(e.touches), base: pending ?? state.current.zoom };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      preview(pinch.base * (dist(e.touches) / pinch.dist));
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (pinch && e.touches.length < 2) { pinch = null; commit(); }
    };

    scrollEl.addEventListener('wheel', onWheel, { passive: false });
    scrollEl.addEventListener('touchstart', onTouchStart, { passive: true });
    scrollEl.addEventListener('touchmove', onTouchMove, { passive: false });
    scrollEl.addEventListener('touchend', onTouchEnd);
    scrollEl.addEventListener('touchcancel', onTouchEnd);
    return () => {
      clearTimeout(timer);
      scrollEl.removeEventListener('wheel', onWheel);
      scrollEl.removeEventListener('touchstart', onTouchStart);
      scrollEl.removeEventListener('touchmove', onTouchMove);
      scrollEl.removeEventListener('touchend', onTouchEnd);
      scrollEl.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [scrollEl]);

  return { ref: target, onRendered };
}
