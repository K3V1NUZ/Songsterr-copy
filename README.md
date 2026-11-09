# Fretline

A Songsterr-style practice app with no built-in song database. You bring your own files:
a **MusicXML or Guitar Pro score**, an **MP3 of the song**, its **BPM**, and optionally
one **backing track per part**. The app syncs the tab to the recording, and you practise with
a cursor, loop, speed control, metronome, count-in and a mixer. It's an installable PWA that works
offline, on desktop and on phones/tablets. Band sharing comes later.

> Work in progress, built in phases.
> **Phase 1 (done):** project setup, data layer, sync math, base components, score rendering.

## Develop

Needs Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run typecheck
npm run build      # production build + service worker in dist/
```

## Stack

React + Vite + TypeScript (strict) · [alphaTab](https://alphatab.net) for rendering MusicXML/Guitar Pro
· Web Audio engine (phase 2) · Dexie (IndexedDB) for offline storage · Zustand · Tailwind CSS ·
vite-plugin-pwa · Supabase later for accounts and band libraries.

## Layout

```
src/
  app/            app shell, routes, shared repository instance
  components/ui/  Button, Toggle, Slider, Panel, TrackItem (styled only with design tokens)
  data/           types, SongRepository interface, LocalRepository (Dexie), song bundles (zip)
  features/       library/, player/ (and later upload/, sync/)
  lib/            score format detection + metadata via alphaTab
  store/          Zustand stores (settings)
  sync/           sync engine: play order, timeline, onset/beat tracking auto-sync (docs/SYNC_ENGINE.md)
  index.css       Tailwind + design tokens (light/dark)
tests/            Vitest tests + fixtures (GP3–GP7, MusicXML)
public/samples/   two example scores (Greensleeves and an original demo riff)
docs/             AI conversion prompt (MusicXML cheat sheet), sync engine design
```

All storage goes through `SongRepository`; a Supabase implementation can replace the local one
without touching the UI. Sync points use alphaTab's own format
(`barIndex`, `barOccurence`, `barPosition`, `millisecondOffset`).
