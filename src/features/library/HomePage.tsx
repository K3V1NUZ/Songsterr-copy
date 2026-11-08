// Shown when no song is open: a short prompt, or a first-run start.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { addSampleSongs, repo } from '@/app/repo';
import { useUi } from '@/store/ui';

export function HomePage() {
  const { openLibrary, openRight, songsChanged, libraryVersion, setCurrent } = useUi();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => { setCurrent(null); }, [setCurrent]);
  useEffect(() => { void repo.listSongs().then((s) => setCount(s.length)); }, [libraryVersion]);

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="mb-2 text-xl font-semibold">{count === 0 ? 'Your tab library is empty' : 'Pick a song'}</h1>
        <p className="mb-6 text-ink-2">
          {count === 0
            ? 'Add a MusicXML or Guitar Pro score with a recording of the song. Fretline lines them up so the tab follows the music.'
            : 'Search your songs above, or add a new one.'}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" icon="plus" onClick={() => openRight({ kind: 'upload' })}>Add a song</Button>
          {count ? <Button icon="search" onClick={() => openLibrary(true)}>Browse songs</Button> : null}
          {count === 0 && <Button onClick={() => void addSampleSongs().then(() => { songsChanged(); openLibrary(true); })}>Try the sample songs</Button>}
        </div>
      </div>
    </div>
  );
}
