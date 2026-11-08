// Mixer (right side panel): recording, one channel per backing track, metronome, MIDI synth.
import { cx, SidePanel, Slider, Button } from '@/components/ui';
import type { Song } from '@/data/types';
import { CHANNEL_MAIN, CHANNEL_METRONOME, type PlayerController } from './PlayerController';
import { usePlayer } from './playerStore';

interface Props {
  song: Song;
  controller: PlayerController;
  onClose: () => void;
  onEditFiles: () => void;
}

export function MixerPanel({ song, controller, onClose, onEditFiles }: Props) {
  const { channels, mode } = usePlayer();
  const rows: Array<{ id: string; name: string; detail?: string; solo: boolean }> =
    mode === 'media'
      ? [
          { id: CHANNEL_MAIN, name: 'Recording', solo: true },
          ...song.stems.map((s) => ({ id: s.id, name: s.name, detail: song.parts.find((p) => p.id === s.partId)?.name, solo: true })),
          { id: CHANNEL_METRONOME, name: 'Metronome', detail: 'Also used for the count-in', solo: false },
        ]
      : [{ id: 'synth', name: 'MIDI synth', detail: 'No recording yet — the score is played by the synthesizer', solo: false }];

  return (
    <SidePanel title="Mixer" side="right" width="300px" onClose={onClose}
      footer={<div className="px-2 py-2"><Button variant="ghost" icon="plus" onClick={onEditFiles}>{mode === 'media' ? 'Add backing track' : 'Add the recording'}</Button></div>}>
      {rows.map((r) => {
        const ch = channels[r.id] ?? { volume: r.id === CHANNEL_METRONOME ? 0.7 : 1, muted: false, solo: false };
        return (
          <div key={r.id} className="border-b border-line px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate">{r.name}</div>
                {r.detail && <div className="truncate text-xs text-muted">{r.detail}</div>}
              </div>
              {r.solo && (
                <button type="button" aria-pressed={ch.solo} aria-label={`Solo ${r.name}`} onClick={() => controller.setSolo(r.id, !ch.solo)}
                  className={cx('h-6 w-6 rounded-control border text-[11px] font-semibold', ch.solo ? 'border-accent text-accent' : 'border-line text-muted')}>S</button>
              )}
              <button type="button" aria-pressed={ch.muted} aria-label={`Mute ${r.name}`} onClick={() => controller.setMuted(r.id, !ch.muted)}
                className={cx('h-6 w-6 rounded-control border text-[11px] font-semibold', ch.muted ? 'border-danger text-danger' : 'border-line text-muted')}>M</button>
            </div>
            <Slider value={ch.volume} onChange={(v) => controller.setVolume(r.id, v)} format={(v) => `${Math.round(v * 100)}`} aria-label={`${r.name} volume`} />
          </div>
        );
      })}
    </SidePanel>
  );
}
