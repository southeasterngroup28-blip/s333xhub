-- ============================================================
-- S333XHUB — Step 5: chat (community group chat + fan↔artist DMs)
-- Run once in the Supabase dashboard: SQL Editor → New query
-- ============================================================

-- A channel is one conversation: the single community group chat,
-- or a 1:1 DM. The `type` column is what lets us add more channels
-- later (multiple group rooms, etc.) without a rewrite.
create table public.channels (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('group', 'dm')),
  created_at timestamptz not null default now()
);

-- Who is in each channel. Mute and leave are timestamps instead of
-- booleans so we also know WHEN it happened. Leaving keeps the row,
-- so rejoining is just clearing left_at.
create table public.channel_members (
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  muted_at timestamptz,
  left_at timestamptz,
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index channel_members_user_idx on public.channel_members (user_id);

-- The messages themselves. `deleted_at` is for step 6 moderation:
-- deleting will hide a message, never destroy the evidence.
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index messages_channel_created_idx on public.messages (channel_id, created_at desc);

alter table public.channels enable row level security;
alter table public.channel_members enable row level security;
alter table public.messages enable row level security;

-- Helper functions that check membership WITHOUT tripping over RLS.
-- (A channel_members policy that queries channel_members again causes
-- an infinite-recursion error — `security definer` sidesteps that.)
create function public.is_channel_member(cid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.channel_members
    where channel_id = cid and user_id = auth.uid()
  );
$$;

create function public.can_post_in(cid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.channel_members
    where channel_id = cid and user_id = auth.uid() and left_at is null
  );
$$;

-- Base table access (this project grants app roles nothing by default).
-- Note there is NO insert grant on channels or channel_members: those
-- rows are only ever created by the trusted functions/triggers below.
grant select on public.channels to authenticated;
grant select, update (muted_at, left_at, last_read_at) on public.channel_members to authenticated;
grant select, insert on public.messages to authenticated;

-- You can only see channels you're a member of (and their member lists).
create policy "members can read their channels"
  on public.channels for select to authenticated
  using (public.is_channel_member(id));

create policy "members can read channel members"
  on public.channel_members for select to authenticated
  using (public.is_channel_member(channel_id));

-- You can update only YOUR OWN membership row (mute/leave/read marker —
-- the column grant above already limits which columns).
create policy "members can update own membership"
  on public.channel_members for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "members can read messages"
  on public.messages for select to authenticated
  using (public.is_channel_member(channel_id));

-- Sending: must be you, and you must be a member who hasn't left.
create policy "members can send messages"
  on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.can_post_in(channel_id));

-- ============================================================
-- The one community group chat, with every existing user enrolled.
-- ============================================================
insert into public.channels (type) values ('group');

insert into public.channel_members (channel_id, user_id)
select c.id, p.id
from public.channels c, public.profiles p
where c.type = 'group';

-- Every FUTURE signup gets auto-enrolled the moment their profile
-- is created (rides on the existing signup trigger chain).
create function public.enroll_in_group_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.channel_members (channel_id, user_id)
  select id, new.id from public.channels where type = 'group'
  on conflict do nothing;
  return new;
end;
$$;

create trigger on_profile_created_enroll_chat
  after insert on public.profiles
  for each row execute function public.enroll_in_group_chat();

-- ============================================================
-- DMs: a fan taps "Message the artist" and this finds their existing
-- DM or creates it (channel + both memberships) in one safe step.
-- Runs as a trusted function so fans never need insert rights.
-- ============================================================
create function public.get_or_create_dm()
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

grant execute on function public.get_or_create_dm() to authenticated;

-- ============================================================
-- Live updates: broadcast new message rows to connected apps.
-- RLS still applies — you only receive messages from your channels.
-- ============================================================
alter publication supabase_realtime add table public.messages;
