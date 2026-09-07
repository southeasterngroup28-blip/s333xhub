-- ============================================================
-- S333XHUB — Shows: tour dates fans can see, the artist manages,
-- and a push the moment a new one is announced.
-- Run once in: SQL Editor → New query
-- (Safe to re-run: everything below is if-not-exists / or-replace.)
-- ============================================================

-- ------------------------------------------------------------
-- 1 · THE TABLE. One row per show. Times are stored as absolute
-- instants; `timezone` (IANA name) is the venue's zone so the app
-- and the push both show the local door time, not the fan's.
-- ------------------------------------------------------------
create table if not exists public.shows (
  id uuid primary key default gen_random_uuid(),
  title text,                                  -- optional tour/show name
  venue text not null,
  city text not null,                          -- "Miami, FL"
  starts_at timestamptz not null,
  timezone text not null default 'America/New_York',
  ticket_url text,                             -- null = "Tickets soon"
  status text not null default 'announced'
    check (status in ('announced', 'sold_out', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Upcoming / past lists both sort on this.
create index if not exists shows_starts_at_idx on public.shows (starts_at);

-- Ticket links are web links, full stop (the app checks too; this is the backstop).
alter table public.shows drop constraint if exists shows_ticket_url_http;
alter table public.shows
  add constraint shows_ticket_url_http
  check (ticket_url is null or ticket_url ~* '^https?://');

alter table public.shows enable row level security;

-- This project grants app roles nothing by default — explicit grants or 42501.
grant select on public.shows to authenticated;
grant insert, update, delete on public.shows to authenticated; -- policies limit to artist

drop policy if exists "everyone sees shows" on public.shows;
create policy "everyone sees shows"
  on public.shows for select to authenticated
  using (true);

drop policy if exists "artist adds shows" on public.shows;
create policy "artist adds shows"
  on public.shows for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

drop policy if exists "artist updates shows" on public.shows;
create policy "artist updates shows"
  on public.shows for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

drop policy if exists "artist deletes shows" on public.shows;
create policy "artist deletes shows"
  on public.shows for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

-- ------------------------------------------------------------
-- 2 · updated_at keeps itself honest. First table in the project
-- that edits rows in place from the app, so this helper is new;
-- reuse it for any future table with an updated_at column.
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

drop trigger if exists shows_touch_updated_at on public.shows;
create trigger shows_touch_updated_at
  before update on public.shows
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3 · The "Show announcements" switch in Settings. A missing row
-- (or a row written before this column existed) still means "on".
-- ------------------------------------------------------------
alter table public.notification_prefs add column if not exists shows boolean not null default true;

-- ------------------------------------------------------------
-- 4 · New show → every fan's lock screen (not the artist's own
-- phone, and not anyone who turned show announcements off).
-- Rides the machinery from step-push.sql / step-launch.sql:
-- tapping the push opens the Shows screen.
-- ------------------------------------------------------------
create or replace function public.push_on_show_announced()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  msgs jsonb;
  when_label text;
begin
  begin
    -- Only a fresh, future announcement is news. Back-filling an old
    -- date for the archive, or adding a sold-out/cancelled row, stays quiet.
    if new.status <> 'announced' or new.starts_at < now() then return new; end if;
    -- "Sep 6" in the venue's own zone; a bad zone name falls back to UTC
    -- rather than losing the push.
    begin
      when_label := to_char(new.starts_at at time zone new.timezone, 'Mon FMDD');
    exception when others then
      when_label := to_char(new.starts_at at time zone 'UTC', 'Mon FMDD');
    end;
    select jsonb_agg(jsonb_build_object(
      'to', pt.token,
      'title', 'New show announced',
      'body', new.city || ' · ' || new.venue || ' · ' || when_label,
      'sound', 'default',
      'data', jsonb_build_object('url', '/shows')
    ))
    into msgs
    from public.push_tokens pt
    join public.profiles pr on pr.id = pt.user_id and pr.role <> 'artist'
    left join public.notification_prefs np on np.user_id = pt.user_id
    where coalesce(np.shows, true);
    if msgs is not null then perform public.send_expo_push(msgs); end if;
  exception when others then
    raise warning 'show push failed: %', sqlerrm;
  end;
  return new;
end;
$$;
revoke execute on function public.push_on_show_announced() from public, anon, authenticated;

drop trigger if exists on_show_announced_push on public.shows;
create trigger on_show_announced_push
  after insert on public.shows
  for each row execute function public.push_on_show_announced();
