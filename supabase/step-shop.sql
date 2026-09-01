-- ============================================================
-- S333XSHOP — numbered limited drops (3D-printed collectibles).
-- Money does NOT move yet: no insert grants on claims; rows will
-- come from the Stripe webhook later (or the dashboard for tests),
-- exactly like the purchases table.
-- Run once in: SQL Editor → New query
-- ============================================================

-- One drop = one numbered run of one piece.
create table public.drops (
  id uuid primary key default gen_random_uuid(),
  drop_number int not null unique,            -- DROP 001, 002 …
  title text not null,
  project text not null check (project in ('mazze', 's333xgod')),
  price_cents int not null check (price_cents > 0),
  run_size int not null check (run_size between 1 and 1000),
  drops_at timestamptz not null,              -- countdown target
  image_path text,                            -- shop-media bucket
  is_published boolean not null default false, -- publish = live + push
  created_at timestamptz not null default now()
);

-- Who owns which numbered piece. Public by design — the registry flex.
-- No shipping data lives here (that stays private, below).
create table public.drop_claims (
  id uuid primary key default gen_random_uuid(),
  drop_id uuid not null references public.drops (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  edition_number int not null,
  status text not null default 'paid'
    check (status in ('paid', 'in_works', 'shipped')),
  platform text not null default 'manual' check (platform in ('manual', 'stripe')),
  created_at timestamptz not null default now(),
  unique (drop_id, edition_number),           -- a number sells once, ever
  unique (drop_id, user_id)                   -- limit 1 per fan
);

-- Shipping + tracking, visible only to the owner and the artist.
create table public.drop_fulfillment (
  claim_id uuid primary key references public.drop_claims (id) on delete cascade,
  address text,
  tracking text,
  shipped_at timestamptz
);

alter table public.drops enable row level security;
alter table public.drop_claims enable row level security;
alter table public.drop_fulfillment enable row level security;

-- This project grants app roles nothing by default — explicit grants or 42501.
grant select on public.drops to authenticated;
grant insert, update, delete on public.drops to authenticated; -- policies limit to artist
grant select on public.drop_claims to authenticated;
grant update on public.drop_claims to authenticated;     -- policy limits to artist
grant select, update, insert on public.drop_fulfillment to authenticated; -- policy-limited

create policy "everyone sees published drops"
  on public.drops for select to authenticated
  using (
    is_published
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist')
  );

create policy "artist manages drops"
  on public.drops for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

create policy "artist updates drops"
  on public.drops for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

create policy "artist deletes drops"
  on public.drops for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

-- The registry: every signed-in fan can see which numbers are taken.
create policy "claims are the public registry"
  on public.drop_claims for select to authenticated
  using (true);

create policy "artist updates claim status"
  on public.drop_claims for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

create policy "owner and artist see fulfillment"
  on public.drop_fulfillment for select to authenticated
  using (
    exists (select 1 from public.drop_claims c where c.id = claim_id and c.user_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist')
  );

create policy "artist writes fulfillment"
  on public.drop_fulfillment for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

create policy "artist edits fulfillment"
  on public.drop_fulfillment for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

-- ============================================================
-- Shop images: public bucket (promotional art), artist-only writes.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('shop-media', 'shop-media', true)
on conflict (id) do nothing;

create policy "artist uploads shop media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'shop-media'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist')
  );

create policy "artist replaces shop media"
  on storage.objects for update to authenticated
  using (bucket_id = 'shop-media'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'))
  with check (bucket_id = 'shop-media'
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

-- ============================================================
-- The claim gate, for when Stripe goes live: one atomic function is
-- the ONLY way a claim row appears. It enforces run size, number
-- uniqueness, and the 1-per-fan limit under concurrency.
-- ============================================================
create or replace function public.claim_edition(p_drop uuid, p_user uuid, p_edition int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  claim_id uuid;
begin
  select * into d from public.drops where id = p_drop for update;
  if d is null or not d.is_published then raise exception 'Drop not found.'; end if;
  if now() < d.drops_at then raise exception 'Drop has not opened yet.'; end if;
  if p_edition < 1 or p_edition > d.run_size then raise exception 'No such number.'; end if;
  insert into public.drop_claims (drop_id, user_id, edition_number, platform)
  values (p_drop, p_user, p_edition, 'stripe')
  returning id into claim_id;
  return claim_id;
end;
$$;
-- Deliberately NOT granted to authenticated — only trusted server code
-- (the Stripe webhook) will call this, with the service role.

-- ============================================================
-- Pushes, riding the machinery from step-push.sql:
--   publish a drop  → every fan's lock screen
--   mark shipped    → that one fan's lock screen
-- ============================================================
create or replace function public.push_on_drop_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  msgs jsonb;
begin
  if old.is_published or not new.is_published then return new; end if;
  select jsonb_agg(jsonb_build_object(
    'to', pt.token,
    'title', case when new.project = 's333xgod' then 'S333XGOD' else 'MAZZE' end || ' DROP',
    'body', new.title || ' · ' || new.run_size || ' numbered. Gone when they''re gone.',
    'sound', 'default'
  ))
  into msgs
  from public.push_tokens pt
  left join public.notification_prefs np on np.user_id = pt.user_id
  where coalesce(np.new_posts, true);
  if msgs is not null then perform public.send_expo_push(msgs); end if;
  return new;
end;
$$;

create trigger on_drop_published_push
  after update on public.drops
  for each row execute function public.push_on_drop_publish();

create or replace function public.push_on_claim_shipped()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  msgs jsonb;
  d record;
begin
  if new.status <> 'shipped' or old.status = 'shipped' then return new; end if;
  select * into d from public.drops where id = new.drop_id;
  select jsonb_agg(jsonb_build_object(
    'to', pt.token,
    'title', 'Your piece shipped 📦',
    'body', d.title || ' #' || new.edition_number || ' is on the way.',
    'sound', 'default'
  ))
  into msgs
  from public.push_tokens pt
  where pt.user_id = new.user_id;
  if msgs is not null then perform public.send_expo_push(msgs); end if;
  return new;
end;
$$;

create trigger on_claim_shipped_push
  after update on public.drop_claims
  for each row execute function public.push_on_claim_shipped();
