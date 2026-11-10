// Sync storage: local first, push when online, newest edit wins (docs/SYNC_ENGINE.md §10).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository } from '@/data/LocalRepository';
import { exportSongBundle, importSongBundle } from '@/data/bundle';
import { remoteFromEnv, supabaseRemote, SyncStore, type SyncRemote } from '@/sync/storage';
import type { Anchor, SyncData } from '@/sync/types';

const anchors = (t0: number): Anchor[] => [0, 1, 2].map((j) => ({ scoreBeat: j, time: t0 + j * 0.5, source: 'auto', confidence: 1 }));

/** An in-memory server; `down` makes every call fail. */
function fakeRemote() {
  const rows = new Map<string, SyncData>();
  const r = {
    rows, down: false, pushes: 0,
    async pull(id: string) { if (r.down) throw new Error('offline'); const d = rows.get(id); return d ? { ...d } : undefined; },
    async push(d: SyncData) { if (r.down) throw new Error('offline'); r.pushes++; rows.set(d.songId, { ...d, dirty: false }); },
  } satisfies SyncRemote & Record<string, unknown>;
  return r;
}

let n = 0;
let local: LocalRepository;
beforeEach(() => { local = new LocalRepository(`sync-${n++}`); });

describe('SyncStore', () => {
  it('works without a server: saves locally, dirty', async () => {
    const store = new SyncStore(local, null);
    await store.save({ songId: 's', anchors: anchors(1), globalOffset: 0.02 });
    expect(await store.load('s')).toMatchObject({ globalOffset: 0.02, dirty: true, algoVersion: 1 });
    expect(await store.flush()).toBe(0);
  });

  it('pushes edits made offline once online, then clears the dirty flag', async () => {
    const remote = fakeRemote();
    let online = false;
    const store = new SyncStore(local, remote, () => online);
    await store.save({ songId: 's', anchors: anchors(1), globalOffset: 0 });
    await store.flush();
    expect(remote.pushes).toBe(0);
    online = true;
    expect(await store.flush()).toBe(1);
    expect(remote.rows.get('s')!.anchors[0]!.time).toBe(1);
    expect((await local.getSync('s'))!.dirty).toBe(false);
  });

  it('keeps the edit dirty when the push fails', async () => {
    const remote = fakeRemote();
    remote.down = true;
    const store = new SyncStore(local, remote, () => true);
    await store.save({ songId: 's', anchors: anchors(1), globalOffset: 0 });
    await store.flush().catch(() => {});
    expect((await local.getSync('s'))!.dirty).toBe(true);
    remote.down = false;
    await store.flush();
    expect((await local.getSync('s'))!.dirty).toBe(false);
  });

  it('newest edit wins: a later edit from another device replaces the local one', async () => {
    const remote = fakeRemote();
    const phone = new SyncStore(local, remote, () => true);
    const laptop = new SyncStore(new LocalRepository(`sync-${n++}`), remote, () => true);
    await phone.save({ songId: 's', anchors: anchors(1), globalOffset: 0 }, 1000);
    await phone.flush();
    await laptop.save({ songId: 's', anchors: anchors(2), globalOffset: 0 }, 2000);
    await laptop.flush();
    expect((await phone.load('s'))!.anchors[0]!.time).toBe(2);
  });

  it('an older local edit does not overwrite a newer one on the server', async () => {
    const remote = fakeRemote();
    remote.rows.set('s', { songId: 's', anchors: anchors(5), globalOffset: 0, algoVersion: 1, updatedAt: 5000, dirty: false });
    const store = new SyncStore(local, remote, () => true);
    await local.putSync({ songId: 's', anchors: anchors(1), globalOffset: 0, algoVersion: 1, updatedAt: 1000, dirty: true });
    await store.flush();
    expect(remote.rows.get('s')!.anchors[0]!.time).toBe(5);
    expect((await local.getSync('s'))!.anchors[0]!.time).toBe(5);
  });

  it('keeps the local auto-sync result when the server copy wins', async () => {
    const remote = fakeRemote();
    remote.rows.set('s', { songId: 's', anchors: anchors(5), globalOffset: 0, algoVersion: 1, updatedAt: 5000, dirty: false });
    await local.putSync({ songId: 's', anchors: anchors(1), autoAnchors: anchors(1), globalOffset: 0, algoVersion: 1, updatedAt: 1000, dirty: false });
    const got = await new SyncStore(local, remote, () => true).load('s');
    expect(got!.anchors[0]!.time).toBe(5);
    expect(got!.autoAnchors?.[0]!.time).toBe(1);
  });
});

describe('Supabase remote', () => {
  it('upserts and reads rows in the song_sync shape', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = (async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      if (!init?.method) return new Response(JSON.stringify([{ song_id: 's', anchors: anchors(1), global_offset: 0.1, algo_version: 1, updated_at: '2026-01-01T00:00:00.000Z' }]));
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const remote = supabaseRemote({ url: 'https://x.supabase.co/', anonKey: 'anon', fetch: fetchMock });
    await remote.push({ songId: 's', anchors: anchors(1), globalOffset: 0.1, algoVersion: 1, updatedAt: Date.parse('2026-01-01T00:00:00Z'), dirty: true });
    const got = await remote.pull('s');
    expect(calls[0]!.url).toBe('https://x.supabase.co/rest/v1/song_sync?on_conflict=song_id');
    expect(JSON.parse(calls[0]!.init!.body as string)).toMatchObject({ song_id: 's', global_offset: 0.1, algo_version: 1, updated_at: '2026-01-01T00:00:00.000Z' });
    expect((calls[0]!.init!.headers as Record<string, string>).Prefer).toContain('merge-duplicates');
    expect(calls[1]!.url).toBe('https://x.supabase.co/rest/v1/song_sync?song_id=eq.s&select=*');
    expect(got).toMatchObject({ songId: 's', globalOffset: 0.1, updatedAt: Date.parse('2026-01-01T00:00:00Z'), dirty: false });
  });

  it('is only used when configured', () => {
    expect(remoteFromEnv({})).toBeNull();
    expect(remoteFromEnv({ VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'k' })).not.toBeNull();
  });
});

describe('repository and bundles', () => {
  it('deleting a song deletes its sync; bundles carry the anchors', async () => {
    const score = await local.putFile({ kind: 'score', name: 's.musicxml', blob: new Blob(['<score-partwise/>']) });
    const song = await local.createSong({ title: 'T', artist: 'A', bpm: 120, tags: [], scoreFileId: score.id, scoreFormat: 'musicxml', parts: [], stems: [], syncPoints: [], syncSource: 'manual' });
    await local.putSync({ songId: song.id, anchors: anchors(3), globalOffset: 0.03, algoVersion: 1, updatedAt: 1, dirty: false });
    const copy = await importSongBundle(local, await exportSongBundle(local, song.id));
    expect(await local.getSync(copy.id)).toMatchObject({ globalOffset: 0.03, dirty: true });
    expect((await local.getSync(copy.id))!.anchors[0]!.time).toBe(3);
    await local.deleteSong(song.id);
    expect(await local.getSync(song.id)).toBeUndefined();
  });
});
