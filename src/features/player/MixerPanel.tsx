// Mixer: recording, one channel per stem, metronome, MIDI synth.
import { Button, Slider } from '@/components/ui';
import type { Song } from '@/data/types';
import { CHANNEL_MAIN, CHANNEL_METRONOME, type PlayerController } from './PlayerController';
import { usePlayer } from './playerStore';

interface Props {
  song: Song;
  controller: PlayerController;
  onAttachRecording: () => void;
  onAddStem: () => void;
}

export function MixerPanel({ song, controller, onAttachRecording, onAddStem }: Props) {
  const { channels, mode } = usePlayer();
  const rows: Array<{ id: string; name: string; detail?: string }> =
    mode === 'media'
      ? [
          { id: CHANNEL_MAIN, name: 'Recording' },
          ...song.stems.map((s) => ({ id: s.id, name: s.name, detail: song.parts.find((p) => p.id === s.partId)?.name })),
          { id: CHANNEL_METRONOME, name: 'Metronome' },
        ]
      : [{ id: 'synth', name: 'MIDI synth', detail: 'No recording attached — the score is played by the synthesizer' }];

  return (
    <div className="space-y-1">
      {rows.map((r) => {
        const ch = channels[r.id] ?? { volume: r.id === CHANNEL_METRONOME ? 0.7 : 1, muted: false, solo: false };
        return (
          <div key={r.id} className="rounded-control px-1 py-1">
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.name}</div>
                {r.detail && <div className="truncate text-xs text-muted">{r.detail}</div>}
              </div>
              {mode === 'media' && r.id !== CHANNEL_METRONOME && (
                <Button size="sm" variant="ghost" className="w-9 justify-center px-0" active={ch.solo} onClick={() => controller.setSolo(r.id, !ch.solo)} aria-label={`Solo ${r.name}`}>S</Button>
              )}
              <Button size="sm" variant="ghost" className="w-9 justify-center px-0" active={ch.muted} onClick={() => controller.setMuted(r.id, !ch.muted)} aria-label={`Mute ${r.name}`}>M</Button>
            </div>
            <Slider value={ch.volume} min={0} max={1} step={0.01} onChange={(v) => controller.setVolume(r.id, v)} format={(v) => `${Math.round(v * 100)}`} aria-label={`${r.name} volume`} />
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2 pt-2">
        {mode === 'synth' || !song.audioFileId ? (
          <Button size="sm" onClick={onAttachRecording}>Attach recording…</Button>
        ) : (
          <Button size="sm" onClick={onAddStem}>Add stem…</Button>
        )}
      </div>
    </div>
  );
}
