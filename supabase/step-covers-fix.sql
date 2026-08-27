-- ============================================================
-- S333XHUB — Fix: allow the artist to set a post's cover art
-- (cover is written as an update after the post is created)
-- Run once in: SQL Editor → New query
-- ============================================================
grant update (cover_path) on public.posts to authenticated;

create policy "artist can update posts"
  on public.posts for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));
