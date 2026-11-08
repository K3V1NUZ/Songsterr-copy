// "Add a song": one panel with the score, recording, BPM, title/artist and optional stems.
import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '@/components/icons';
import { Button, cx, Field, IconButton, inputClass, SidePanel } from '@/components/ui';
import { repo } from '@/app/repo';
import { useUi } from '@/store/ui';
import { checkScore, createSongFromUpload, SCORE_ACCEPT, type ScoreCheck } from './createSong';

interface Picked { name: string; blob: Blob }

export function DropZone({ icon, label, hint, accept, file, onFile, onClear }: {
  icon: IconName; label: string; hint: string; accept: string; file?: string; onFile: (f: File) => void; onClear?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); };
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={cx('flex items-center gap-3 rounded-control border border-dashed px-3 py-3', over ? 'border-accent bg-accent-soft' : 'border-line-strong')}
    >
      <span className="text-ink-2"><Icon name={icon} size={22} /></span>
      <div className="min-w-0 flex-1">
        {file ? <div className="truncate font-medium">{file}</div> : <div className="font-medium">{label}</div>}
        <div className="truncate text-xs text-muted">{file ? 'Drop another file to replace it' : hint}</div>
      </div>
      {file && onClear && <IconButton icon="close" label="Remove" size="sm" onClick={onClear} />}
      <Button size="sm" onClick={() => input.current?.click()}>{file ? 'Change' : 'Choose'}</Button>
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-line px-4 py-4">
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

export function UploadPanel({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const songsChanged = useUi((s) => s.songsChanged);
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [score, setScore] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [pasted, setPasted] = useState('');
  const [check, setCheck] = useState<ScoreCheck | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [bpm, setBpm] = useState('');
  const [tags, setTags] = useState('');
  const [recording, setRecording] = useState<Picked | null>(null);
  const [stems, setStems] = useState<Array<Picked & { partIndex: number | '' }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stemInput = useRef<HTMLInputElement>(null);

  const useScore = (name: string, bytes: Uint8Array) => {
    const c = checkScore(bytes);
    setScore({ name, bytes });
    setCheck(c);
    if (c.ok && c.info) {
      setTitle(c.info.title === 'Untitled' ? name.replace(/\.[^.]+$/, '') : c.info.title);
      setArtist(c.info.artist);
      setBpm(String(Math.round(c.info.tempo)));
    }
  };
  const onScoreFile = async (f: File) => useScore(f.name, new Uint8Array(await f.arrayBuffer()));
  const onPasteCheck = () => { if (pasted.trim()) useScore('song.musicxml', new TextEncoder().encode(pasted)); };

  const parts = check?.info?.parts ?? [];
  const canSave = !!score && !!check?.ok && !busy;
  const summary = useMemo(() => {
    if (!check) return null;
    if (!check.ok) return <p className="text-danger">Can't read this file: {check.error}</p>;
    const i = check.info!;
    return <p className="text-ink-2"><Icon name="check" size={14} className="mr-1 inline text-ok" />{i.parts.length} part{i.parts.length === 1 ? '' : 's'} ({i.parts.map((p) => p.name).join(', ')}) · ♩ = {Math.round(i.tempo)}</p>;
  }, [check]);

  const save = async () => {
    if (!score || !check?.ok) return;
    setBusy(true);
    setError('');
    try {
      const song = await createSongFromUpload(repo, {
        score,
        ...(recording ? { recording } : {}),
        bpm: Number(bpm) || undefined,
        title, artist,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        stems: stems.map((s) => ({ name: s.name, blob: s.blob, ...(s.partIndex !== '' ? { partIndex: s.partIndex } : {}) })),
      });
      songsChanged();
      onClose();
      navigate(`/song/${song.id}`, { state: { autoSync: !!recording } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel title="Add a song" side="right" width="440px" overlay onClose={onClose}
      footer={
        <div className="flex items-center gap-2 px-4 py-3">
          {error && <span className="min-w-0 flex-1 truncate text-danger" title={error}>{error}</span>}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!canSave} onClick={() => void save()}>{busy ? 'Adding…' : 'Add song'}</Button>
        </div>
      }>
      <Section title="Score">
        <div className="flex gap-4 text-[13px]">
          <button type="button" className={mode === 'file' ? 'font-semibold' : 'text-ink-2'} onClick={() => setMode('file')}>File</button>
          <button type="button" className={mode === 'paste' ? 'font-semibold' : 'text-ink-2'} onClick={() => setMode('paste')}>Paste MusicXML</button>
        </div>
        {mode === 'file' ? (
          <DropZone icon="file" label="MusicXML or Guitar Pro file" hint=".musicxml .xml .mxl · .gp .gp3 .gp4 .gp5 .gpx" accept={SCORE_ACCEPT}
            file={score?.name} onFile={(f) => void onScoreFile(f)} />
        ) : (
          <>
            <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={6} spellCheck={false}
              placeholder="Paste the MusicXML an AI wrote for you…"
              className={cx(inputClass, 'h-auto py-2 font-mono text-xs')} />
            <Button size="sm" onClick={onPasteCheck} disabled={!pasted.trim()}>Check</Button>
          </>
        )}
        {summary}
      </Section>

      <Section title="Details">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Title"><input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Artist"><input className={inputClass} value={artist} onChange={(e) => setArtist(e.target.value)} /></Field>
          <Field label="BPM of the recording" hint="Helps auto-sync. Use the score's tempo if unsure.">
            <input className={inputClass} inputMode="decimal" value={bpm} onChange={(e) => setBpm(e.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
          <Field label="Tags" hint="Comma separated"><input className={inputClass} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="rock, drop D" /></Field>
        </div>
      </Section>

      <Section title="Recording">
        <DropZone icon="music" label="MP3 of the song" hint="The tab will follow this recording" accept="audio/*"
          file={recording?.name} onFile={(f) => setRecording({ name: f.name, blob: f })} onClear={() => setRecording(null)} />
      </Section>

      <Section title="Backing tracks (optional)">
        <p className="text-xs text-muted">One audio file per player, e.g. “bass only”. Each gets its own fader in the mixer.</p>
        {stems.map((s, i) => (
          <div key={`${s.name}-${i}`} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            <select className={cx(inputClass, '!w-40 shrink-0')} value={s.partIndex} aria-label={`Part for ${s.name}`}
              onChange={(e) => setStems((list) => list.map((x, k) => (k === i ? { ...x, partIndex: e.target.value === '' ? '' : Number(e.target.value) } : x)))}>
              <option value="">Not linked</option>
              {parts.map((p, k) => <option key={p.id} value={k}>{p.name}</option>)}
            </select>
            <IconButton icon="close" label={`Remove ${s.name}`} size="sm" onClick={() => setStems((list) => list.filter((_, k) => k !== i))} />
          </div>
        ))}
        <Button size="sm" icon="plus" onClick={() => stemInput.current?.click()}>Add backing track</Button>
        <input ref={stemInput} type="file" accept="audio/*" multiple hidden
          onChange={(e) => { const fs = [...(e.target.files ?? [])]; setStems((list) => [...list, ...fs.map((f) => ({ name: f.name, blob: f, partIndex: '' as const }))]); e.target.value = ''; }} />
      </Section>
    </SidePanel>
  );
}
