import Dexie, { type EntityTable } from 'dexie';
import { matchesQuery, newId, sortSongs, type SongRepository } from './SongRepository';
import type { SyncData } from '@/sync/types';
import type { FileBlob, FileKind, Id, NewSong, Song, SongQuery, SongSettings, SyncPoint } from './types';

class FretlineDB extends Dexie {
  songs!: EntityTable<Song, 'id'>;
  files!: EntityTable<FileBlob, 'id'>;
  settings!: EntityTable<SongSettings, 'songId'>;
  sync!: EntityTable<SyncData, 'songId'>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      songs: 'id, title, artist, updatedAt, bandId',
      files: 'id, kind',
      settings: 'songId',
    });
    // anchors-based sync (docs/SYNC_ENGINE.md §10)
    this.version(2).stores({ sync: 'songId, updatedAt' });
  }
}

/** Offline-first storage in IndexedDB. */
export class LocalRepository implements SongRepository {
  readonly db: FretlineDB;

  constructor(dbName = 'fretline') {
    this.db = new FretlineDB(dbName);
  }

  async listSongs(query: SongQuery = {}): Promise<Song[]> {
    const all = await this.db.songs.toArray();
    return sortSongs(all.filter((s) => matchesQuery(s, query.text)), query.sort);
  }

  getSong(id: Id): Promise<Song | undefined> {
    return this.db.songs.get(id);
  }

  async createSong(input: NewSong): Promise<Song> {
    const now = Date.now();
    const song: Song = { ...input, id: input.id ?? newId(), createdAt: now, updatedAt: now, syncVersion: input.syncPoints.length ? 1 : 0 };
    await this.db.songs.add(song);
    return song;
  }

  async updateSong(id: Id, patch: Partial<Omit<Song, 'id' | 'createdAt'>>): Promise<Song> {
    return this.db.transaction('rw', this.db.songs, async () => {
      const cur = await this.db.songs.get(id);
      if (!cur) throw new Error(`Song ${id} not found`);
      const next: Song = { ...cur, ...patch, id, createdAt: cur.createdAt, updatedAt: Date.now() };
      if (patch.syncPoints && patch.syncVersion === undefined) next.syncVersion = cur.syncVersion + 1;
      await this.db.songs.put(next);
      return next;
    });
  }

  saveSyncPoints(id: Id, points: SyncPoint[], source: Song['syncSource'], confidence?: number): Promise<Song> {
    const sorted = [...points].sort((a, b) => a.millisecondOffset - b.millisecondOffset);
    return this.updateSong(id, { syncPoints: sorted, syncSource: source, ...(confidence !== undefined ? { syncConfidence: confidence } : {}) });
  }

  async deleteSong(id: Id): Promise<void> {
    await this.db.transaction('rw', [this.db.songs, this.db.files, this.db.settings, this.db.sync], async () => {
      const song = await this.db.songs.get(id);
      if (!song) return;
      const fileIds = [song.scoreFileId, song.audioFileId, ...song.stems.map((s) => s.fileId)].filter((x): x is Id => !!x);
      await this.db.files.bulkDelete(fileIds);
      await this.db.settings.delete(id);
      await this.db.sync.delete(id);
      await this.db.songs.delete(id);
    });
  }

  async putFile({ kind, name, mime, blob }: { kind: FileKind; name: string; mime?: string; blob: Blob }): Promise<FileBlob> {
    const file: FileBlob = { id: newId(), kind, name, mime: mime || blob.type || 'application/octet-stream', size: blob.size, blob };
    await this.db.files.add(file);
    return file;
  }

  getFile(id: Id): Promise<FileBlob | undefined> {
    return this.db.files.get(id);
  }

  async deleteFile(id: Id): Promise<void> {
    await this.db.files.delete(id);
  }

  getSettings(songId: Id): Promise<SongSettings | undefined> {
    return this.db.settings.get(songId);
  }

  async saveSettings(settings: SongSettings): Promise<void> {
    await this.db.settings.put(settings);
  }

  getSync(songId: Id): Promise<SyncData | undefined> {
    return this.db.sync.get(songId);
  }

  async putSync(data: SyncData): Promise<void> {
    await this.db.sync.put(data);
  }

  async listDirtySync(): Promise<SyncData[]> {
    return (await this.db.sync.toArray()).filter((d) => d.dirty);
  }

  async deleteSync(songId: Id): Promise<void> {
    await this.db.sync.delete(songId);
  }

  async usedBytes(): Promise<number> {
    let total = 0;
    await this.db.files.each((f) => { total += f.size; });
    return total;
  }
}
