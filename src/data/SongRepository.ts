import type { FileBlob, FileKind, Id, NewSong, Song, SongQuery, SongSettings, SyncPoint } from './types';

/**
 * All storage goes through this interface. LocalRepository (IndexedDB/Dexie)
 * implements it now; a SupabaseRepository will implement it in phase 5.
 */
export interface SongRepository {
  listSongs(query?: SongQuery): Promise<Song[]>;
  getSong(id: Id): Promise<Song | undefined>;
  createSong(song: NewSong): Promise<Song>;
  /** Shallow-merges `patch`; bumps updatedAt (and syncVersion when sync points change). */
  updateSong(id: Id, patch: Partial<Omit<Song, 'id' | 'createdAt'>>): Promise<Song>;
  /** Saves new sync points, bumping syncVersion. */
  saveSyncPoints(id: Id, points: SyncPoint[], source: Song['syncSource'], confidence?: number): Promise<Song>;
  /** Deletes the song and every file it references. */
  deleteSong(id: Id): Promise<void>;

  putFile(file: { kind: FileKind; name: string; mime?: string; blob: Blob }): Promise<FileBlob>;
  getFile(id: Id): Promise<FileBlob | undefined>;
  deleteFile(id: Id): Promise<void>;

  getSettings(songId: Id): Promise<SongSettings | undefined>;
  saveSettings(settings: SongSettings): Promise<void>;

  /** Total bytes of stored files (shown to the user; storage quotas matter on phones). */
  usedBytes(): Promise<number>;
}

export function newId(): Id {
  return crypto.randomUUID();
}

export function matchesQuery(song: Song, text: string | undefined): boolean {
  if (!text?.trim()) return true;
  const hay = [song.title, song.artist, song.tuning ?? '', ...song.tags, ...song.parts.map((p) => `${p.name} ${p.instrument}`)]
    .join(' ')
    .toLowerCase();
  return text.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

export function sortSongs(songs: Song[], sort: SongQuery['sort'] = 'recent'): Song[] {
  const s = [...songs];
  if (sort === 'title') s.sort((a, b) => a.title.localeCompare(b.title));
  else if (sort === 'artist') s.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
  else s.sort((a, b) => b.updatedAt - a.updatedAt);
  return s;
}
