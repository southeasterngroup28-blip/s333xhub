-- ============================================================
-- S333XHUB — Launch musts: ban system + purchase protection
-- Run once in: SQL Editor → New query
-- (Safe to re-run: everything below is if-exists / or-replace.)
-- ============================================================

-- ------------------------------------------------------------
-- 1 · BAN SYSTEM. A ban is a timestamp on the profile: set it and
-- the fan can't write anywhere (chat, comments, reactions, votes);
-- clear it and they're back. Reads stay open — a ban is a write-mute
-- plus the app-side lockout, not an erasure.
-- ------------------------------------------------------------
alter table public.profiles add column if not exists banned_at timestamptz;

-- One question, asked everywhere: is this user banned?
-- (security definer so policies can check it without a profiles grant.)
create or replace function public.is_banned(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = uid and banned_at is not null
  );
$$;
revoke execute on function public.is_banned(uuid) from public, anon;
grant execute on function public.is_banned(uuid) to authenticated;

-- The switch. Only the artist can flip it (checked inside), and the
-- artist account itself can never be banned.
create or replace function public.ban_user(target_user uuid, banned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist') then
    raise exception 'Only the artist can do this.';
  end if;
  if exists (select 1 from public.profiles p where p.id = target_user and p.role = 'artist') then
    raise exception 'The artist account cannot be banned.';
  end if;
  update public.profiles
  set banned_at = case when banned then now() else null end
  where id = target_user;
end;
$$;
revoke execute on function public.ban_user(uuid, boolean) from public, anon;
grant execute on function public.ban_user(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- 1b · Enforcement, chat: replaces the step-6 helper so the message
-- send policy also refuses banned users (membership + block checks
-- are kept exactly as they were).
-- ------------------------------------------------------------
create or replace function public.can_post_in(cid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    not public.is_banned(auth.uid())
    and exists (
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

-- ------------------------------------------------------------
-- 1c · Enforcement, social: the three fan-write policies get the ban
-- check bolted onto their original definitions. Posts need nothing —
-- they're artist-only already.
-- ------------------------------------------------------------
drop policy if exists "comment as yourself" on public.post_comments;
create policy "comment as yourself"
  on public.post_comments for insert to authenticated
  with check (user_id = auth.uid() and not public.is_banned(auth.uid()));

drop policy if exists "react as yourself" on public.post_reactions;
create policy "react as yourself"
  on public.post_reactions for insert to authenticated
  with check (user_id = auth.uid() and not public.is_banned(auth.uid()));

drop policy if exists "vote as yourself" on public.poll_votes;
create policy "vote as yourself"
  on public.poll_votes for insert to authenticated
  with check (
    user_id = auth.uid()
    and not public.is_banned(auth.uid())
    and exists (select 1 from public.polls pl where pl.post_id = poll_votes.post_id
                and (pl.ends_at is null or pl.ends_at > now()))
  );

-- Fan mail lands in the artist's private inbox — a banned fan doesn't
-- get that channel either. (Weekly limit kept exactly as it was.)
drop policy if exists "send fan mail as yourself, once a week" on public.fan_mail;
create policy "send fan mail as yourself, once a week"
  on public.fan_mail for insert to authenticated
  with check (
    user_id = auth.uid()
    and not public.is_banned(auth.uid())
    and not exists (
      select 1 from public.fan_mail existing
      where existing.user_id = auth.uid()
        and existing.created_at > now() - interval '7 days'
    )
  );

-- ...and the fan-mail upload folder closes with it (same original
-- condition + the ban check), so the API can't be used to push files.
drop policy if exists "fans upload into their own fan-mail folder" on storage.objects;
create policy "fans upload into their own fan-mail folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'fan-mail'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not public.is_banned(auth.uid())
  );

-- ------------------------------------------------------------
-- 1d · A banned fan's name, status, and avatar still render on their
-- old comments and messages — so they can't keep editing them. Self-
-- edits are refused; the artist's ban/unban (a different auth.uid())
-- and service-role writes are untouched.
-- ------------------------------------------------------------
create or replace function public.block_banned_profile_edits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.banned_at is not null and auth.uid() = old.id then
    raise exception using message = 'ACCOUNT_SUSPENDED: this account is suspended';
  end if;
  return new;
end;
$$;
revoke execute on function public.block_banned_profile_edits() from public, anon, authenticated;

drop trigger if exists freeze_banned_profiles on public.profiles;
create trigger freeze_banned_profiles
  before update on public.profiles
  for each row execute function public.block_banned_profile_edits();

-- ------------------------------------------------------------
-- 2 · PURCHASE PROTECTION. A post fans have paid for can never be
-- deleted — not by a stray tap, not by a cascade. Deleting it would
-- take away something people bought.
-- ------------------------------------------------------------

-- "How many fans bought this?" — so the app can warn the artist
-- before they even try. Artist-only, checked inside.
create or replace function public.count_post_buyers(post uuid)
returns integer
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  n integer;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist') then
    raise exception 'Only the artist can do this.';
  end if;
  select count(*) into n from public.purchases where post_id = post;
  return n;
end;
$$;
revoke execute on function public.count_post_buyers(uuid) from public, anon;
grant execute on function public.count_post_buyers(uuid) to authenticated;

-- The hard stop, at the database layer. BEFORE DELETE fires ahead of
-- the purchases cascade, so the rows are still there to check.
-- The app catches the PROTECTED_POST prefix and shows friendly copy.
--
-- delete_my_account is safe: a fan's cascade wipes fan-owned rows
-- (their purchases, comments, votes, memberships — and drop_claims
-- just go user_id = null), never a post — posts belong to the artist.
-- Artist account deletion while sold posts exist IS blocked by this
-- trigger, and that is intentional: fans keep what they paid for.
create or replace function public.block_sold_post_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.purchases where post_id = old.id) then
    raise exception using message = 'PROTECTED_POST: fans have purchased this post';
  end if;
  return old;
end;
$$;
revoke execute on function public.block_sold_post_delete() from public, anon, authenticated;

drop trigger if exists protect_sold_posts on public.posts;
create trigger protect_sold_posts
  before delete on public.posts
  for each row execute function public.block_sold_post_delete();
