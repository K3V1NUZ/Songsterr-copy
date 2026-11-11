// Line icons (24×24, stroke = currentColor).
import type { SVGProps } from 'react';

const PATHS = {
  search: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></>,
  guitar: <><path d="M14 10 20 4M18 2l4 4" /><path d="M14 10c-1-1-3-1-4 0l-.5.5c-2-.5-4 0-5.5 1.5-2 2-2 5 0 7s5 2 7 0c1.5-1.5 2-3.5 1.5-5.5l.5-.5c1-1 1-3 0-4z" /><circle cx="9" cy="15" r="1.2" /></>,
  bass: <><path d="M15 9 21 3M19 1l4 4" /><path d="M15 9c-1.2-1.2-3-1.2-4.2 0l-.6.6c-2.2-.6-4.4 0-6 1.6-2.4 2.4-2.4 5.6 0 8s5.6 2.4 8 0c1.6-1.6 2.2-3.8 1.6-6l.6-.6c1.2-1.2 1.2-3 0-4.2z" /></>,
  drums: <><ellipse cx="12" cy="9" rx="8" ry="3" /><path d="M4 9v6c0 1.7 3.6 3 8 3s8-1.3 8-3V9M5 3l5 5M19 3l-5 5" /></>,
  keys: <><rect x="3" y="5" width="18" height="14" rx="1" /><path d="M8 5v8M12 5v8M16 5v8" /></>,
  voice: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  wave: <path d="M3 12h2l2-6 3 12 3-9 2 5 2-2h4" />,
  prev: <><path d="M6 5v14" /><path d="M18 6l-9 6 9 6z" /></>,
  play: <path d="M7 5v14l12-7z" fill="currentColor" stroke="none" />,
  pause: <path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" stroke="none" />,
  loop: <><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" /></>,
  metronome: <><path d="M9 3h6l4 18H5z" /><path d="M12 15l5-8" /></>,
  countIn: <><path d="M4 18h3M9 18h3M14 18h3M19 18h1" /><path d="M5 6v8M10 9v5M15 12v2" /></>,
  mixer: <><path d="M6 4v16M12 4v16M18 4v16" /><path d="M4 9h4M10 15h4M16 7h4" /></>,
  sync: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  zoomIn: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5M8 11h6M11 8v6" /></>,
  zoomOut: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5M8 11h6" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
  upload: <><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" /><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></>,
  download: <><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" /><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></>,
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></>,
  music: <><path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13 7l4 4" /></>,
  sidebar: <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M9 4v16" /></>,
  check: <path d="M5 12l5 5 9-10" />,
  pin: <><path d="M9 4h6l-1 6 3 3H7l3-3z" /><path d="M12 13v7" /></>,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>,
  redo: <><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6" /><circle cx="12" cy="17" r=".6" fill="currentColor" /></>,
  chevronDown: <path d="M6 9l6 6 6-6" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {PATHS[name]}
    </svg>
  );
}

export function instrumentIcon(instrument: string): IconName {
  if (instrument === 'bass') return 'bass';
  if (instrument === 'drums') return 'drums';
  if (instrument === 'keys') return 'keys';
  if (instrument === 'vocals') return 'voice';
  if (instrument === 'audio') return 'wave';
  return 'guitar';
}
