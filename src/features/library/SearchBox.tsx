// Top-bar search: live suggestions below the field while typing; Enter or "Show all" opens the
// song window in the middle of the screen.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { repo } from '@/app/repo';
import type { Song } from '@/data/types';
import { useUi } from '@/store/ui';

const MAX = 6;

/** Wraps the matched part of `text` in <mark>. */
function Hl({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark className="bg-transparent font-semibold text-ink">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

export function SearchBox() {
  const { query, setQuery, openLibrary, left, libraryVersion, searchFocus } = useUi();
  const [focused, setFocused] = useState(false);
  const [list, setList] = useState<Song[]>([]);
  const [listQ, setListQ] = useState<string | null>(null); // the query `list` belongs to
  const [total, setTotal] = useState(0);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const q = query.trim();

  // "/" focuses search (desktop habit)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target as HTMLElement | null)?.closest('input, textarea, select')) { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // something else (e.g. clicking the artist) asked for the field
  useEffect(() => { if (searchFocus) { input.current?.focus(); setFocused(true); } }, [searchFocus]);

  useEffect(() => {
    let live = true;
    void repo.listSongs({ text: q, sort: 'recent' }).then((all) => {
      if (!live) return;
      setList(all.slice(0, MAX));
      setListQ(q);
      setTotal(all.length);
      setActive(-1);
    });
    return () => { live = false; };
  }, [q, libraryVersion]);

  // close the suggestions when clicking elsewhere
  useEffect(() => {
    if (!focused) return;
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setFocused(false); };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [focused]);

  const close = () => { setFocused(false); input.current?.blur(); };
  const open = (s: Song) => { navigate(`/song/${s.id}`); setQuery(''); close(); };
  const showAll = () => { openLibrary(true); close(); };

  const open_ = focused && left !== 'library';
  const rows = list.length;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(rows, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      // results for an older query may still be on screen: then show the window instead of guessing
      const s = listQ === q ? list[active] : undefined;
      if (s) open(s); else showAll();
    } else if (e.key === 'Escape') close();
  };

  return (
    <div ref={box} className="relative w-full">
      <label className={cx('flex h-8 items-center gap-2 rounded-control border px-2.5', open_ || left ? 'border-accent' : 'border-line')}>
        <span className="text-muted"><Icon name="search" /></span>
        <input
          ref={input}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setFocused(true); }}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
          placeholder="Search your songs"
          aria-label="Search your songs"
          role="combobox"
          aria-expanded={open_}
          aria-controls="search-suggestions"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
        />
        {query ? (
          <button type="button" aria-label="Clear search" className="text-muted hover:text-ink" onClick={() => { setQuery(''); input.current?.focus(); }}>
            <Icon name="close" size={14} />
          </button>
        ) : <kbd className="hidden text-xs text-muted md:inline">/</kbd>}
      </label>

      {open_ && (
        <div id="search-suggestions" role="listbox"
          className="absolute inset-x-0 top-9 z-50 overflow-hidden rounded-panel border border-line bg-surface shadow-[0_8px_24px_rgb(0_0_0/0.12)]">
          {!q && rows > 0 && <div className="px-3 pt-2 pb-1 text-xs text-muted">Recent</div>}
          {rows === 0 && <div className="px-3 py-3 text-ink-2">{q ? `No songs match “${q}”.` : 'No songs yet.'}</div>}
          {list.map((s, i) => (
            <button key={s.id} type="button" role="option" aria-selected={active === i}
              onPointerEnter={() => setActive(i)} onClick={() => open(s)}
              className={cx('flex w-full items-baseline gap-2 px-3 py-1.5 text-left', active === i && 'bg-hover')}>
              <span className="min-w-0 truncate"><span className="text-ink"><Hl text={s.title} q={q} /></span>
                {s.artist && <span className="text-ink-2"> — <Hl text={s.artist} q={q} /></span>}</span>
              {s.tuning && <span className="ml-auto shrink-0 text-xs text-muted">{s.tuning}</span>}
            </button>
          ))}
          {total > 0 && (
            <button type="button" role="option" aria-selected={active === rows} onPointerEnter={() => setActive(rows)} onClick={showAll}
              className={cx('w-full border-t border-line px-3 py-2 text-left text-accent', active === rows && 'bg-hover')}>
              {q ? `Show all results (${total})` : `Browse all songs (${total})`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
