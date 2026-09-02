-- ============================================================
-- S333XSHOP hardening: checkout holds (no oversell), refunds that
-- free the number, and expiry cleanup.
-- Run once in: SQL Editor → New query
-- ============================================================

-- Claims gain two lifecycle states:
--   'hold'      — number reserved while its buyer is inside checkout
--   'refunded'  — money returned; the number goes back on the shelf
alter table public.drop_claims drop constraint drop_claims_status_check;
alter table public.drop_claims
  add constraint drop_claims_status_check
    check (status in ('hold', 'paid', 'in_works', 'shipped', 'refunded'));
alter table public.drop_claims add column expires_at timestamptz;

-- Uniqueness must ignore refunded rows (a refunded number can sell again),
-- so the plain unique constraints become partial unique indexes.
alter table public.drop_claims drop constraint drop_claims_drop_id_edition_number_key;
alter table public.drop_claims drop constraint drop_claims_drop_id_user_id_key;
create unique index drop_claims_live_edition
  on public.drop_claims (drop_id, edition_number) where status <> 'refunded';
create unique index drop_claims_live_user
  on public.drop_claims (drop_id, user_id) where status <> 'refunded';

-- Sweep out expired holds for one drop (called before anything counts).
create or replace function public.purge_expired_holds(p_drop uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.drop_claims
  where drop_id = p_drop and status = 'hold' and expires_at < now();
$$;

-- The moment a fan taps BUY: reserve their number for 10 minutes while
-- they're inside Stripe checkout. Caller identity comes from auth.uid()
-- — a client can only ever hold for itself.
create or replace function public.start_checkout_hold(p_drop uuid, p_edition int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  hold_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  perform public.purge_expired_holds(p_drop);
  select * into d from public.drops where id = p_drop for update;
  if d is null or not d.is_published then raise exception 'Drop not found.'; end if;
  if now() < d.drops_at then raise exception 'Drop has not opened yet.'; end if;
  if p_edition < 1 or p_edition > d.run_size then raise exception 'No such number.'; end if;
  insert into public.drop_claims (drop_id, user_id, edition_number, status, platform, expires_at)
  values (p_drop, auth.uid(), p_edition, 'hold', 'stripe', now() + interval '10 minutes')
  returning id into hold_id;
  return hold_id;
end;
$$;
grant execute on function public.start_checkout_hold(uuid, int) to authenticated;

-- Payment confirmed (Stripe webhook, service role only): the hold
-- becomes ownership. Falls back to a direct claim if no hold exists.
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
  perform public.purge_expired_holds(p_drop);
  select * into d from public.drops where id = p_drop for update;
  if d is null or not d.is_published then raise exception 'Drop not found.'; end if;

  update public.drop_claims
  set status = 'paid', expires_at = null
  where drop_id = p_drop and user_id = p_user and edition_number = p_edition and status = 'hold'
  returning id into claim_id;
  if claim_id is not null then return claim_id; end if;

  insert into public.drop_claims (drop_id, user_id, edition_number, platform)
  values (p_drop, p_user, p_edition, 'stripe')
  returning id into claim_id;
  return claim_id;
end;
$$;

-- Money returned (webhook or dashboard): the row stays as a record,
-- the number frees up automatically via the partial indexes.
create or replace function public.refund_claim(p_claim uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.drop_claims set status = 'refunded', expires_at = null where id = p_claim;
$$;
-- claim_edition and refund_claim stay service-only: no grants.
