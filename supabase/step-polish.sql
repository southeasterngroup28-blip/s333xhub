-- ============================================================
-- S333XHUB — Polish sprint: avatars + cover-art teasers
-- Run once in the Supabase dashboard: SQL Editor → New query
-- ============================================================

-- Profile photos. The path points into the public 'avatars' bucket.
alter table public.profiles add column avatar_path text;
grant update (avatar_path) on public.profiles to authenticated;

-- Avatars are public (they're shown to every user everywhere — signed
-- URLs would expire constantly). Filenames are random, folder = owner.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "users upload own avatar"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "users replace own avatar"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "users delete own avatar"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Cover art is promotional — locked posts may show their (blurred)
-- cover as a teaser, so covers escape the vault seal. The actual
-- audio/video/photos stay sealed.
create policy "covers are always viewable"
  on storage.objects for select to authenticated
  using (bucket_id = 'post-media' and storage.filename(name) like 'cover.%');
