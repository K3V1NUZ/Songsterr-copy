import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository } from '@/data/LocalRepository';
import { applyFilter, checkScore, createSongFromUpload, needsSync, replaceRecording, replaceScore, syncLabel } from '@/features/upload/createSong';

const gs = new Uint8Array(readFileSync('public/samples/greensleeves.musicxml'));
const riff = new Uint8Array(readFileSync('tests/fixtures/demo-riff.gp5'));
const mp3 = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' });

let repo: LocalRepository;
let n = 0;
beforeEach(() => { repo = new LocalRepository(`upload-${n++}`); });

describe('upload', () => {
  it('reads title, artist, tempo and parts from the score', () => {
    const c = checkScore(gs);
    expect(c.ok).toBe(true);
    expect([c.info!.title, c.info!.artist, c.info!.tempo]).toEqual(['Greensleeves', 'Traditional', 100]);
    expect(c.info!.parts.map((p) => [p.name, p.instrument])).toEqual([['Melody', 'guitar'], ['Rhythm', 'guitar'], ['Bass', 'bass']]);
  });
  it('rejects files that are not scores', () => {
    const c = checkScore(new TextEncoder().encode('hello'));
    expect(c.ok).toBe(false);
    expect(c.error).toBeTruthy();
  });
  it('creates a song with recording, BPM, tags and stems linked to parts', async () => {
    const song = await createSongFromUpload(repo, {
      score: { name: 'riff.gp5', bytes: riff }, recording: { name: 'take.mp3', blob: mp3() }, bpm: 118, artist: 'My Band', tags: ['rock'],
      stems: [{ name: 'bass-only.mp3', blob: mp3(), partIndex: 2 }, { name: 'click.mp3', blob: mp3() }],
    });
    expect([song.title, song.artist, song.bpm, song.scoreFormat, song.tags]).toEqual(['Demo Riff', 'My Band', 118, 'gp5', ['rock']]);
    expect(song.parts.map((p) => p.instrument)).toEqual(['guitar', 'guitar', 'bass', 'drums']);
    expect(song.stems[0]!.partId).toBe(song.parts[2]!.id);
    expect(song.stems[0]!.name).toBe('bass-only');
    expect(song.stems[1]!.partId).toBeUndefined();
    expect(song.audioFileId).toBeTruthy();
    expect(needsSync(song)).toBe(true);
    expect(syncLabel(song).text).toBe('not synced');
  });
  it('replacing the recording clears the sync; replacing the score keeps stems linked', async () => {
    let song = await createSongFromUpload(repo, { score: { name: 'riff.gp5', bytes: riff }, recording: { name: 'a.mp3', blob: mp3() }, stems: [{ name: 'b.mp3', blob: mp3(), partIndex: 2 }] });
    song = await repo.saveSyncPoints(song.id, [{ barIndex: 0, barOccurence: 0, barPosition: 0, millisecondOffset: 1000 }], 'auto', 0.9);
    expect(syncLabel(song).text).toBe('synced');
    song = await replaceRecording(repo, song, 'b.mp3', mp3());
    expect([song.syncPoints.length, song.syncSource]).toEqual([0, 'none']);
    const stemPartIndex = song.parts.find((p) => p.id === song.stems[0]!.partId)!.trackIndex;
    song = await replaceScore(repo, song, 'riff2.gp5', riff);
    expect(song.parts.find((p) => p.id === song.stems[0]!.partId)!.trackIndex).toBe(stemPartIndex);
  });
  it('filters the library by instrument and sync state', async () => {
    const a = await createSongFromUpload(repo, { score: { name: 'gs.musicxml', bytes: gs } });
    const b = await createSongFromUpload(repo, { score: { name: 'riff.gp5', bytes: riff }, recording: { name: 'x.mp3', blob: mp3() } });
    const all = [a, b];
    expect(applyFilter(all, 'drums').map((s) => s.title)).toEqual(['Demo Riff']);
    expect(applyFilter(all, 'bass')).toHaveLength(2);
    expect(applyFilter(all, 'needs-sync').map((s) => s.title)).toEqual(['Demo Riff']);
  });
});
