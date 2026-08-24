-- ============================================================
-- S333XHUB — Step 8: notification preferences + device tokens
-- Run once in: SQL Editor → New query
-- ============================================================

-- Each user's per-type opt-outs (Apple requires these to exist).
-- A missing row means "all on" — rows appear when someone first
-- flips a switch.
create table public.notification_prefs (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  new_posts boolean not null default true,
  group_chat boolean not null default true,
  dms boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;
grant select, insert, update on public.notification_prefs to authenticated;

create policy "users read own prefs"
  on public.notification_prefs for select to authenticated
  using (user_id = auth.uid());

create policy "users create own prefs"
  on public.notification_prefs for insert to authenticated
  with check (user_id = auth.uid());

create policy "users update own prefs"
  on public.notification_prefs for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Where to deliver pushes: one row per device. Filled in by the real
-- app (needs a development build); harmless and empty until then.
create table public.push_tokens (
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

alter table public.push_tokens enable row level security;
grant select, insert, update, delete on public.push_tokens to authenticated;

create policy "users manage own push tokens"
  on public.push_tokens for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
