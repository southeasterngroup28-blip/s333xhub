-- ============================================================
-- S333XHUB — Step 2: feed (posts + photos)
-- Run once in the Supabase dashboard: SQL Editor → New query
-- ============================================================

-- One row per post. `project` says which tab it appears in.
-- `kind` already allows audio/video so steps 3-4 don't need a migration.
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  project text not null check (project in ('mazze', 's333xgod')),
  kind text not null default 'text' check (kind in ('text', 'photo', 'audio', 'video')),
  body text,
  created_at timestamptz not null default now()
);

-- Fast "newest posts for this tab" queries.
create index posts_project_created_idx on public.posts (project, created_at desc);

-- Files attached to a post (photos now; audio/video later).
create table public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  storage_path text not null,
  media_type text not null,
  width int,
  height int,
  position int not null default 0
);

create index post_media_post_idx on public.post_media (post_id);

alter table public.posts enable row level security;
alter table public.post_media enable row level security;

-- Base table access for signed-in users (new Supabase projects grant none
-- by default). The RLS policies below still decide which rows are allowed.
grant select, insert, delete on public.posts to authenticated;
grant select, insert, delete on public.post_media to authenticated;

-- Reading: any signed-in user. Writing: only the artist — the database
-- checks the role itself, so a bug in app code can't let a fan post.
create policy "signed-in users can read posts"
  on public.posts for select to authenticated using (true);

create policy "artist can create posts"
  on public.posts for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist')
  );

create policy "artist can delete posts"
  on public.posts for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

create policy "signed-in users can read post media"
  on public.post_media for select to authenticated using (true);

create policy "artist can add post media"
  on public.post_media for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

create policy "artist can delete post media"
  on public.post_media for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

-- ============================================================
-- Storage: a PRIVATE bucket for post files. Nothing in it has a
-- public URL — the app asks for short-lived signed links instead.
-- This is deliberately the same structure paid unlocks will use.
-- ============================================================
insert into storage.buckets (id, name, public) values ('post-media', 'post-media', false);

create policy "signed-in users can read post files"
  on storage.objects for select to authenticated
  using (bucket_id = 'post-media');

create policy "artist can upload post files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'post-media'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist')
  );

create policy "artist can delete post files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'post-media'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist')
  );
