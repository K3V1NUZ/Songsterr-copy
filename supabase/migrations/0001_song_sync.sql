-- Sync data per song (docs/SYNC_ENGINE.md §10). The app pushes here when VITE_SUPABASE_URL and
-- VITE_SUPABASE_ANON_KEY are set; without them sync stays on the device.
--
-- song_id should reference songs(id) once songs live in Supabase:
--   alter table song_sync add foreign key (song_id) references songs(id) on delete cascade;
create table if not exists song_sync (
  song_id       uuid primary key,
  anchors       jsonb       not null,
  global_offset real        not null default 0,
  algo_version  int         not null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) default auth.uid()
);

alter table song_sync enable row level security;

-- Until there are accounts and band libraries: signed-in users may read and write every row.
-- Tighten this to band membership when bands exist.
create policy "song_sync read" on song_sync for select to authenticated using (true);
create policy "song_sync write" on song_sync for insert to authenticated with check (true);
create policy "song_sync update" on song_sync for update to authenticated using (true) with check (true);
