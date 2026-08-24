-- ============================================================
-- S333XHUB — Social layer: reactions, comments, Top 8, polls, mood
-- Run once in: SQL Editor → New query
-- ============================================================

-- ------------------------------------------------------------
-- A · Reactions: one tap, one row. A user can use several emojis
-- on the same post, but each only once.
-- ------------------------------------------------------------
create table public.post_reactions (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (emoji in ('†', '🔥', '💀', '😭')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, emoji)
);

alter table public.post_reactions enable row level security;
grant select, insert, delete on public.post_reactions to authenticated;

create policy "anyone signed in reads reactions"
  on public.post_reactions for select to authenticated using (true);
create policy "react as yourself"
  on public.post_reactions for insert to authenticated with check (user_id = auth.uid());
create policy "unreact as yourself"
  on public.post_reactions for delete to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------
-- B · Comments: the wall. Artist can pin one and soft-delete any.
-- ------------------------------------------------------------
create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index post_comments_post_idx on public.post_comments (post_id, created_at);

alter table public.post_comments enable row level security;
grant select, insert on public.post_comments to authenticated;
grant update (pinned, deleted_at) on public.post_comments to authenticated;

create policy "anyone signed in reads comments"
  on public.post_comments for select to authenticated using (true);
create policy "comment as yourself"
  on public.post_comments for insert to authenticated with check (user_id = auth.uid());
create policy "artist moderates comments"
  on public.post_comments for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

-- Fast comment counts for a page of posts.
create function public.comment_counts(pids uuid[])
returns table (post_id uuid, cnt bigint)
language sql stable security definer set search_path = public as $$
  select post_id, count(*) from public.post_comments
  where post_id = any(pids) and deleted_at is null
  group by post_id;
$$;
grant execute on function public.comment_counts(uuid[]) to authenticated;

-- Comments become reportable.
alter table public.reports drop constraint reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('post', 'message', 'user', 'comment'));

-- ------------------------------------------------------------
-- C · Top 8: the artist hand-picks up to 8 fans, shown to everyone.
-- ------------------------------------------------------------
create table public.top_fans (
  position int primary key check (position between 1 and 8),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table public.top_fans enable row level security;
grant select, insert, update, delete on public.top_fans to authenticated;

create policy "everyone sees the top 8"
  on public.top_fans for select to authenticated using (true);
create policy "artist manages the top 8"
  on public.top_fans for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

-- ------------------------------------------------------------
-- E · Polls: a poll is a post (kind 'poll'); the post body is the
-- question. One vote per person, changeable while the poll runs.
-- ------------------------------------------------------------
alter table public.posts drop constraint posts_kind_check;
alter table public.posts add constraint posts_kind_check
  check (kind in ('text', 'photo', 'audio', 'video', 'poll'));

create table public.polls (
  post_id uuid primary key references public.posts (id) on delete cascade,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.polls (post_id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  position int not null default 0
);

create table public.poll_votes (
  post_id uuid not null references public.polls (post_id) on delete cascade,
  option_id uuid not null references public.poll_options (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

grant select on public.polls to authenticated;
grant select on public.poll_options to authenticated;
grant select, insert, update, delete on public.poll_votes to authenticated;
grant insert on public.polls to authenticated;
grant insert on public.poll_options to authenticated;

create policy "read polls" on public.polls for select to authenticated using (true);
create policy "read poll options" on public.poll_options for select to authenticated using (true);
create policy "read poll votes" on public.poll_votes for select to authenticated using (true);

create policy "artist creates polls"
  on public.polls for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));
create policy "artist creates poll options"
  on public.poll_options for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

-- Voting: yours only, and only while the poll is open.
create policy "vote as yourself"
  on public.poll_votes for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.polls pl where pl.post_id = poll_votes.post_id
                and (pl.ends_at is null or pl.ends_at > now()))
  );
create policy "change your vote while open"
  on public.poll_votes for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.polls pl where pl.post_id = poll_votes.post_id
                and (pl.ends_at is null or pl.ends_at > now()))
  );
create policy "remove your vote"
  on public.poll_votes for delete to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------
-- F · Mood: a short status fans wear next to their name.
-- ------------------------------------------------------------
alter table public.profiles add column status text check (char_length(status) <= 60);
grant update (status) on public.profiles to authenticated;
