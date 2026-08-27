-- ============================================================
-- S333XHUB — MySpace-style backgrounds
-- Artist sets an app-wide default; each user may set their own.
-- Run once in: SQL Editor → New query
-- ============================================================

-- Tiny key/value store for app-wide settings the artist controls.
create table public.app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;
grant select, insert, update on public.app_settings to authenticated;

create policy "everyone reads app settings"
  on public.app_settings for select to authenticated using (true);
create policy "artist writes app settings"
  on public.app_settings for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));
create policy "artist updates app settings"
  on public.app_settings for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

-- Per-user personal background (overrides the artist default on their phone).
alter table public.profiles add column background_path text;
grant update (background_path) on public.profiles to authenticated;

-- Where the images live. Everyone signed in can view; you can only
-- upload/replace files in your own folder.
insert into storage.buckets (id, name, public) values ('backgrounds', 'backgrounds', false);

create policy "backgrounds readable by signed-in users"
  on storage.objects for select to authenticated
  using (bucket_id = 'backgrounds');

create policy "upload own background"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "replace own background"
  on storage.objects for update to authenticated
  using (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "delete own background"
  on storage.objects for delete to authenticated
  using (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = auth.uid()::text);
