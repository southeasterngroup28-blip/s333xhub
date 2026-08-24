-- ============================================================
-- S333XHUB — Step 6: moderation (block / report / delete / account deletion)
-- Run once in: SQL Editor → New query
-- (Run step5-chat.sql FIRST if you haven't — this builds on it.)
-- ============================================================

-- ------------------------------------------------------------
-- Blocks: "I don't want to see or hear from this person."
-- ------------------------------------------------------------
create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.blocks enable row level security;
grant select, insert, delete on public.blocks to authenticated;

create policy "users see own blocks"
  on public.blocks for select to authenticated
  using (blocker_id = auth.uid());

create policy "users create own blocks"
  on public.blocks for insert to authenticated
  with check (blocker_id = auth.uid());

create policy "users remove own blocks"
  on public.blocks for delete to authenticated
  using (blocker_id = auth.uid());

-- ------------------------------------------------------------
-- Reports: anyone can flag a post, a message, or a user.
-- Only the artist reads the queue; resolving stamps resolved_at.
-- ------------------------------------------------------------
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'message', 'user')),
  target_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index reports_open_idx on public.reports (created_at desc) where resolved_at is null;

alter table public.reports enable row level security;
grant select, insert on public.reports to authenticated;
grant update (resolved_at) on public.reports to authenticated;

create policy "users can file reports"
  on public.reports for insert to authenticated
  with check (reporter_id = auth.uid());

create policy "artist reads the report queue"
  on public.reports for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

create policy "artist resolves reports"
  on public.reports for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

-- ------------------------------------------------------------
-- Artist can soft-delete any message (hidden, never destroyed).
-- The column grant means even the artist can ONLY touch deleted_at.
-- ------------------------------------------------------------
grant update (deleted_at) on public.messages to authenticated;

create policy "artist can moderate messages"
  on public.messages for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

-- ------------------------------------------------------------
-- Blocks freeze DMs (group chat is unaffected): replaces the
-- step-5 helper so the send policy also checks blocks.
-- ------------------------------------------------------------
create or replace function public.can_post_in(cid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (
      select 1 from public.channel_members
      where channel_id = cid and user_id = auth.uid() and left_at is null
    )
    and not exists (
      select 1
      from public.channels c
      join public.channel_members other
        on other.channel_id = c.id and other.user_id <> auth.uid()
      join public.blocks b
        on (b.blocker_id = other.user_id and b.blocked_id = auth.uid())
        or (b.blocker_id = auth.uid() and b.blocked_id = other.user_id)
      where c.id = cid and c.type = 'dm'
    );
$$;

-- Also stop NEW DMs between blocked pairs.
create or replace function public.get_or_create_dm()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  artist uuid;
  dm_id uuid;
begin
  if me is null then
    raise exception 'Not signed in.';
  end if;

  select id into artist from public.profiles where role = 'artist' limit 1;
  if artist is null then
    raise exception 'No artist account exists yet.';
  end if;
  if me = artist then
    raise exception 'Fans start DMs with you — pick one from your chat list.';
  end if;

  if exists (
    select 1 from public.blocks
    where (blocker_id = artist and blocked_id = me)
       or (blocker_id = me and blocked_id = artist)
  ) then
    raise exception 'Messaging is not available.';
  end if;

  select c.id into dm_id
  from public.channels c
  join public.channel_members mine on mine.channel_id = c.id and mine.user_id = me
  join public.channel_members theirs on theirs.channel_id = c.id and theirs.user_id = artist
  where c.type = 'dm'
  limit 1;

  if dm_id is null then
    insert into public.channels (type) values ('dm') returning id into dm_id;
    insert into public.channel_members (channel_id, user_id)
    values (dm_id, me), (dm_id, artist);
  end if;

  return dm_id;
end;
$$;

-- ------------------------------------------------------------
-- Account deletion (Apple requirement): a fan deletes their own
-- auth user; every table cascades from it. The artist account is
-- protected from accidental self-deletion in the app.
-- ------------------------------------------------------------
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid() and role = 'artist') then
    raise exception 'The artist account cannot be deleted from inside the app.';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

grant execute on function public.delete_my_account() to authenticated;
