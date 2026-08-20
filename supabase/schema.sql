-- ============================================================
-- S333XHUB — Step 1 schema: profiles + roles
-- Run this once in the Supabase dashboard: SQL Editor → New query
-- ============================================================

-- Every signed-up user gets a profile row. `role` is how the app
-- knows who the artist is: everyone starts as 'fan'.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'fan',
  role text not null default 'fan' check (role in ('fan', 'artist')),
  accepted_tos_at timestamptz,
  created_at timestamptz not null default now()
);

-- Row Level Security: the database itself enforces who can see/change what,
-- even if app code has bugs. This is the security backbone of the whole app.
alter table public.profiles enable row level security;

-- Any signed-in user can see profiles (needed later for chat + feed names).
create policy "signed-in users can read profiles"
  on public.profiles for select
  to authenticated
  using (true);

-- Users can update their own row...
create policy "users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ...but only the display_name column. Nobody can promote themselves
-- to 'artist' from the app — that column is off-limits.
-- (New Supabase projects grant app roles NO table access by default,
-- so these grants are required for the app to read profiles at all.)
grant select on public.profiles to authenticated;
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- When a new auth user is created, automatically create their profile.
-- Signup happens with the Terms checkbox required, so we stamp acceptance here.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, accepted_tos_at)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'fan'),
    now()
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- AFTER the artist signs up in the app, make them the artist by
-- running this (replace the email), once:
--
--   update public.profiles set role = 'artist'
--   where id = (select id from auth.users where email = 'ARTIST_EMAIL_HERE');
-- ============================================================
