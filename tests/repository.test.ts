import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository } from '@/data/LocalRepository';
import { exportSongBundle, importSongBundle } from '@/data/bundle';
import type { NewSong } from '@/data/types';

let repo: LocalRepository;
let n = 0;
beforeEach(() => { repo = new LocalRepository(`test-${n++}`); });

async function addSong(over: Partial<NewSong> = {}) {
  const score = await repo.putFile({ kind: 'score', name: 'song.musicxml', blob: new Blob(['<score-partwise/>'], { type: 'application/xml' }) });
  const audio = await repo.putFile({ kind: 'audio', name: 'song.mp3', blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/mpeg' }) });
  const stem = await repo.putFile({ kind: 'stem', name: 'bass.mp3', blob: new Blob([new Uint8Array([9])], { type: 'audio/mpeg' }) });
  return repo.createSong({
    title: 'Song', artist: 'Band', bpm: 120, tags: ['rock'], scoreFileId: score.id, scoreFormat: 'musicxml', audioFileId: audio.id,
    parts: [{ id: 'p1', name: 'Bass', instrument: 'bass', trackIndex: 1 }],
    stems: [{ id: 's1', name: 'Bass stem', fileId: stem.id, partId: 'p1' }],
    syncPoints: [], syncSource: 'none', ...over,
  });
}

describe('LocalRepository', () => {
  it('creates, searches and sorts songs', async () => {
    await addSong({ title: 'Beta', artist: 'Zed' });
    await addSong({ title: 'Alpha', artist: 'Yan', tags: ['jazz'] });
    expect((await repo.listSongs({ sort: 'title' })).map((s) => s.title)).toEqual(['Alpha', 'Beta']);
    expect((await repo.listSongs({ text: 'jazz' })).map((s) => s.title)).toEqual(['Alpha']);
    expect((await repo.listSongs({ text: 'bass zed' })).map((s) => s.title)).toEqual(['Beta']);
  });
  it('bumps syncVersion when sync points change', async () => {
    const s = await addSong();
    expect(s.syncVersion).toBe(0);
    const s2 = await repo.saveSyncPoints(s.id, [{ barIndex: 1, barOccurence: 0, barPosition: 0, millisecondOffset: 2000 }, { barIndex: 0, barOccurence: 0, barPosition: 0, millisecondOffset: 100 }], 'manual');
    expect(s2.syncVersion).toBe(1);
    expect(s2.syncSource).toBe('manual');
    expect(s2.syncPoints[0]!.millisecondOffset).toBe(100);
    const s3 = await repo.updateSong(s.id, { title: 'Renamed' });
    expect(s3.syncVersion).toBe(1);
  });
  it('deletes a song together with its files and settings', async () => {
    const s = await addSong();
    await repo.saveSettings({ songId: s.id, trackIndex: 0, volumes: {}, muted: [], solo: [], speed: 1, zoom: 1, view: 'tab' });
    expect(await repo.usedBytes()).toBeGreaterThan(0);
    await repo.deleteSong(s.id);
    expect(await repo.getSong(s.id)).toBeUndefined();
    expect(await repo.usedBytes()).toBe(0);
    expect(await repo.getSettings(s.id)).toBeUndefined();
  });
});

describe('song bundles', () => {
  it('round-trips a song with its files', async () => {
    const s = await repo.saveSyncPoints((await addSong()).id, [{ barIndex: 0, barOccurence: 0, barPosition: 0, millisecondOffset: 1500 }], 'auto', 0.9);
    const zip = await exportSongBundle(repo, s.id);
    const other = new LocalRepository(`test-${n++}`);
    const copy = await importSongBundle(other, zip);
    expect(copy.id).not.toBe(s.id);
    expect([copy.title, copy.artist, copy.bpm, copy.syncSource, copy.syncConfidence]).toEqual(['Song', 'Band', 120, 'auto', 0.9]);
    expect(copy.syncPoints).toEqual(s.syncPoints);
    expect(copy.stems[0]!.partId).toBe(copy.parts[0]!.id);
    const audio = await other.getFile(copy.audioFileId!);
    expect(new Uint8Array(await audio!.blob!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(await other.usedBytes()).toBe(await repo.usedBytes());
  });
  it('rejects files that are not bundles', async () => {
    const { zipSync, strToU8 } = await import('fflate');
    await expect(importSongBundle(repo, zipSync({ 'x.txt': strToU8('hi') }))).rejects.toThrow(/not a Fretline song bundle/i);
  });
});
