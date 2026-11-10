// Sync storage, local first (docs/SYNC_ENGINE.md §10):
//   1. every result or edit is saved to IndexedDB at once, with dirty = true;
//   2. when online (and on every `online` event) dirty records are pushed to the server;
//   3. when two devices edited the same song, the newest edit (updatedAt) wins.
// The server is optional: without one, sync stays local and works fully offline.
import type { SongRepository } from '@/data/SongRepository';
import type { Anchor, SyncData } from './types';

/** Bump when the auto-sync algorithm changes, so old results can be redone. */
export const ALGO_VERSION = 1;

export interface SyncRemote {
  pull(songId: string): Promise<SyncData | undefined>;
  push(data: SyncData): Promise<void>;
}

type LocalStore = Pick<SongRepository, 'getSync' | 'putSync' | 'listDirtySync'>;

/** The newer of two records (by updatedAt); `a` wins ties. */
export function newest(a: SyncData | undefined, b: SyncData | undefined): SyncData | undefined {
  if (!a) return b;
  if (!b) return a;
  return b.updatedAt > a.updatedAt ? b : a;
}

export type SyncEdit = Pick<SyncData, 'songId' | 'anchors' | 'globalOffset'> & Partial<Pick<SyncData, 'algoVersion' | 'autoAnchors'>>;

export class SyncStore {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly local: LocalStore,
    private readonly remote: SyncRemote | null,
    private readonly isOnline: () => boolean = () => typeof navigator === 'undefined' || navigator.onLine,
  ) {}

  get hasRemote(): boolean {
    return !!this.remote;
  }

  /** The song's sync: the local copy, replaced by the server's when that one is newer. */
  async load(songId: string): Promise<SyncData | undefined> {
    const mine = await this.local.getSync(songId);
    if (!this.remote || !this.isOnline()) return mine;
    let theirs: SyncData | undefined;
    try { theirs = await this.remote.pull(songId); } catch { return mine; }
    const win = newest(mine, theirs);
    if (win && win === theirs && win !== mine) {
      const kept: SyncData = { ...theirs!, dirty: false, ...(mine?.autoAnchors ? { autoAnchors: mine.autoAnchors } : {}) };
      await this.local.putSync(kept);
      return kept;
    }
    return mine;
  }

  /** Saves an edit locally (dirty) and tries to push it. */
  async save(edit: SyncEdit, now = Date.now()): Promise<SyncData> {
    const prev = await this.local.getSync(edit.songId);
    const data: SyncData = {
      algoVersion: prev?.algoVersion ?? ALGO_VERSION,
      ...(prev?.autoAnchors ? { autoAnchors: prev.autoAnchors } : {}),
      ...edit,
      // never older than what is stored, even if the device clock is behind
      updatedAt: Math.max(now, (prev?.updatedAt ?? 0) + 1),
      dirty: true,
    };
    await this.local.putSync(data);
    void this.flush().catch(() => {});
    return data;
  }

  /** Pushes every dirty record. Returns how many were pushed. Runs one at a time. */
  flush(): Promise<number> {
    const run = this.chain.then(() => this.flushNow());
    this.chain = run.catch(() => 0);
    return run;
  }

  private async flushNow(): Promise<number> {
    if (!this.remote || !this.isOnline()) return 0;
    let pushed = 0;
    for (const d of await this.local.listDirtySync()) {
      const theirs = await this.remote.pull(d.songId);
      if (theirs && theirs.updatedAt > d.updatedAt) {
        // edited on another device later: theirs wins
        await this.local.putSync({ ...theirs, dirty: false, ...(d.autoAnchors ? { autoAnchors: d.autoAnchors } : {}) });
        continue;
      }
      await this.remote.push(d);
      // only clear the flag if nothing was saved meanwhile
      const now = await this.local.getSync(d.songId);
      if (now && now.updatedAt === d.updatedAt) await this.local.putSync({ ...now, dirty: false });
      pushed++;
    }
    return pushed;
  }

  /** Pushes now and on every `online` event. Returns a function that stops listening. */
  start(): () => void {
    if (!this.remote || typeof window === 'undefined') return () => {};
    const onOnline = () => { void this.flush().catch(() => {}); };
    window.addEventListener('online', onOnline);
    onOnline();
    return () => window.removeEventListener('online', onOnline);
  }
}

// ---- Supabase (PostgREST) ---------------------------------------------------------------------------
// Table: supabase/migrations/0001_song_sync.sql. Plain fetch, so no client library is needed.

interface SongSyncRow {
  song_id: string;
  anchors: Anchor[];
  global_offset: number;
  algo_version: number;
  updated_at: string;
}

export interface SupabaseOptions {
  url: string;
  anonKey: string;
  /** The signed-in user's access token, once there are accounts. Defaults to the anon key. */
  accessToken?: () => Promise<string | undefined>;
  fetch?: typeof fetch;
}

export function supabaseRemote(opts: SupabaseOptions): SyncRemote {
  const base = `${opts.url.replace(/\/$/, '')}/rest/v1/song_sync`;
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const headers = async (extra: Record<string, string> = {}) => ({
    apikey: opts.anonKey,
    Authorization: `Bearer ${(await opts.accessToken?.()) ?? opts.anonKey}`,
    ...extra,
  });
  return {
    async pull(songId) {
      const res = await doFetch(`${base}?song_id=eq.${encodeURIComponent(songId)}&select=*`, { headers: await headers() });
      if (!res.ok) throw new Error(`Supabase pull failed: ${res.status}`);
      const rows = (await res.json()) as SongSyncRow[];
      const r = rows[0];
      if (!r) return undefined;
      return { songId: r.song_id, anchors: r.anchors, globalOffset: r.global_offset, algoVersion: r.algo_version, updatedAt: Date.parse(r.updated_at), dirty: false };
    },
    async push(d) {
      const row: SongSyncRow = { song_id: d.songId, anchors: d.anchors, global_offset: d.globalOffset, algo_version: d.algoVersion, updated_at: new Date(d.updatedAt).toISOString() };
      const res = await doFetch(`${base}?on_conflict=song_id`, {
        method: 'POST',
        headers: await headers({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(row),
      });
      if (!res.ok) throw new Error(`Supabase push failed: ${res.status}`);
    },
  };
}

/** The Supabase remote when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set, else none (local only). */
export function remoteFromEnv(env: Record<string, string | undefined>): SyncRemote | null {
  const url = env.VITE_SUPABASE_URL, anonKey = env.VITE_SUPABASE_ANON_KEY;
  return url && anonKey ? supabaseRemote({ url, anonKey }) : null;
}
