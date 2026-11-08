// Edit a song's details and files: metadata, replace score/recording, backing tracks, export, delete.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, cx, Field, IconButton, inputClass, SidePanel } from '@/components/ui';
import { repo } from '@/app/repo';
import { exportSongBundle } from '@/data/bundle';
import { newId } from '@/data/SongRepository';
import type { Id, Song } from '@/data/types';
import { replaceRecording, replaceScore, SCORE_ACCEPT } from '@/features/upload/createSong';
import { DropZone } from '@/features/upload/UploadPanel';
import { useUi } from '@/store/ui';
import { bundleName, downloadBytes } from './LibraryPanel';

export function EditSongPanel({ songId, onClose }: { songId: Id; onClose: () => void }) {
  const navigate = useNavigate();
  const { songsChanged, current, setCurrent } = useUi();
  const [song, setSong] = useState<Song>();
  const [form, setForm] = useState({ title: '', artist: '', bpm: '', tags: '', difficulty: 0 });
  const [error, setError] = useState('');
  const [names, setNames] = useState<{ score?: string; audio?: string }>({});
  const stemInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void repo.getSong(songId).then(async (s) => {
      if (!s) return;
      setSong(s);
      setForm({ title: s.title, artist: s.artist, bpm: String(s.bpm), tags: s.tags.join(', '), difficulty: s.difficulty ?? 0 });
      const [sf, af] = await Promise.all([repo.getFile(s.scoreFileId), s.audioFileId ? repo.getFile(s.audioFileId) : undefined]);
      setNames({ score: sf?.name, audio: af?.name });
    });
  }, [songId]);

  const changed = (s: Song) => {
    setSong(s);
    songsChanged();
    if (current?.id === s.id) setCurrent(s);
  };
  const run = async (fn: () => Promise<Song>) => {
    setError('');
    try { changed(await fn()); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  if (!song) return <SidePanel title="Edit song" side="right" overlay onClose={onClose}><p className="p-4 text-muted">Loading…</p></SidePanel>;

  const save = () => run(() => repo.updateSong(song.id, {
    title: form.title.trim() || song.title, artist: form.artist.trim(), bpm: Number(form.bpm) || song.bpm,
    tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean), difficulty: form.difficulty || undefined,
  }));

  return (
    <SidePanel title="Edit details & files" side="right" width="440px" overlay onClose={onClose}
      footer={
        <div className="flex items-center gap-2 px-4 py-3">
          <Button variant="danger" icon="trash" onClick={() => {
            if (!confirm(`Delete “${song.title}” and its files from this device?`)) return;
            void repo.deleteSong(song.id).then(() => { songsChanged(); onClose(); if (current?.id === song.id) navigate('/'); });
          }}>Delete</Button>
          <Button variant="ghost" icon="download" onClick={() => void exportSongBundle(repo, song.id).then((b) => downloadBytes(b, bundleName(song)))}>Export</Button>
          <span className="flex-1" />
          <Button variant="primary" onClick={() => void save().then(onClose)}>Save</Button>
        </div>
      }>
      {error && <p className="px-4 pt-3 text-danger">{error}</p>}
      <section className="grid grid-cols-2 gap-3 border-b border-line px-4 py-4">
        <Field label="Title"><input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <Field label="Artist"><input className={inputClass} value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })} /></Field>
        <Field label="BPM of the recording"><input className={inputClass} inputMode="decimal" value={form.bpm} onChange={(e) => setForm({ ...form, bpm: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        <Field label="Difficulty">
          <select className={inputClass} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: Number(e.target.value) })}>
            <option value={0}>Not set</option>
            {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{'●'.repeat(d)}{'○'.repeat(5 - d)}</option>)}
          </select>
        </Field>
        <div className="col-span-2"><Field label="Tags" hint="Comma separated"><input className={inputClass} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></Field></div>
      </section>
      <section className="space-y-3 border-b border-line px-4 py-4">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Files</h3>
        <DropZone icon="file" label="Score" hint="" accept={SCORE_ACCEPT} file={names.score}
          onFile={(f) => void run(async () => { const s = await replaceScore(repo, song, f.name, new Uint8Array(await f.arrayBuffer())); setNames((n) => ({ ...n, score: f.name })); return s; })} />
        <DropZone icon="music" label="Add the recording (MP3)" hint="Replacing it clears the sync" accept="audio/*" file={names.audio}
          onFile={(f) => void run(async () => { const s = await replaceRecording(repo, song, f.name, f); setNames((n) => ({ ...n, audio: f.name })); return s; })} />
      </section>
      <section className="space-y-2 px-4 py-4">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Backing tracks</h3>
        {song.stems.length === 0 && <p className="text-xs text-muted">None yet.</p>}
        {song.stems.map((st) => (
          <div key={st.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{st.name}</span>
            <select className={cx(inputClass, '!w-40 shrink-0')} value={st.partId ?? ''} aria-label={`Part for ${st.name}`}
              onChange={(e) => void run(() => repo.updateSong(song.id, { stems: song.stems.map((x) => (x.id === st.id ? { id: x.id, name: x.name, fileId: x.fileId, ...(e.target.value ? { partId: e.target.value } : {}) } : x)) }))}>
              <option value="">Not linked</option>
              {song.parts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <IconButton icon="trash" label={`Remove ${st.name}`} size="sm"
              onClick={() => void run(async () => { const s = await repo.updateSong(song.id, { stems: song.stems.filter((x) => x.id !== st.id) }); await repo.deleteFile(st.fileId); return s; })} />
          </div>
        ))}
        <Button size="sm" icon="plus" onClick={() => stemInput.current?.click()}>Add backing track</Button>
        <input ref={stemInput} type="file" accept="audio/*" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void run(async () => {
            const file = await repo.putFile({ kind: 'stem', name: f.name, blob: f });
            return repo.updateSong(song.id, { stems: [...song.stems, { id: newId(), name: f.name.replace(/\.[^.]+$/, ''), fileId: file.id }] });
          });
        }} />
      </section>
    </SidePanel>
  );
}
