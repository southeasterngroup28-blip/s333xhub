-- ============================================================
-- S333XHUB — Tickets: shows can sell tickets in the app (Stripe),
-- fans get a QR ticket, the artist scans it at the door.
-- Run once in: SQL Editor → New query
-- (Safe to re-run: everything below is if-not-exists / or-replace.)
--
-- Money rules, same as the shop and the vault: the app NEVER writes
-- a ticket row. Only the Stripe webhook (service role) can issue or
-- refund one, through the two locked functions in section 5.
-- ============================================================

-- gen_random_bytes (the QR token) lives in pgcrypto. Supabase ships
-- it enabled in the `extensions` schema; this is just the backstop.
create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- 1 · SHOWS learn how they sell. `sales_mode`:
--   'link'   → the existing ticket_url button (default, nothing changes)
--   'in_app' → Stripe checkout inside the app, QR ticket, door scan
--   'none'   → no ticket button at all (free show, invite-only …)
-- `ticket_price_cents` and `capacity` only matter for 'in_app';
-- null capacity = no cap.
-- ------------------------------------------------------------
alter table public.shows add column if not exists sales_mode text not null default 'link';
alter table public.shows add column if not exists ticket_price_cents integer;
alter table public.shows add column if not exists capacity integer;

alter table public.shows drop constraint if exists shows_sales_mode_check;
alter table public.shows
  add constraint shows_sales_mode_check
  check (sales_mode in ('in_app', 'link', 'none'));

alter table public.shows drop constraint if exists shows_ticket_price_nonneg;
alter table public.shows
  add constraint shows_ticket_price_nonneg
  check (ticket_price_cents is null or ticket_price_cents >= 0);

alter table public.shows drop constraint if exists shows_capacity_nonneg;
alter table public.shows
  add constraint shows_capacity_nonneg
  check (capacity is null or capacity >= 0);

-- ------------------------------------------------------------
-- 2 · PROFILES remember their Stripe customer so a returning fan
-- sees saved cards in the payment sheet. Written ONLY by the server
-- (the payment-intent edge function, service role) — the app's
-- update grant is still display_name-only, so fans can't touch it.
-- ------------------------------------------------------------
alter table public.profiles add column if not exists stripe_customer_id text;

-- ------------------------------------------------------------
-- 3 · THE TABLE. One row per paid ticket. `qr_token` is what the QR
-- code carries (random, unguessable); `stripe_payment_intent_id` is
-- the receipt and the idempotency key (Stripe may deliver the same
-- event twice — the second delivery must not mint a second ticket).
-- `user_id` is nullable + set-null so a sold ticket survives the
-- buyer deleting their account (same call as drop_claims).
-- `status` 'refunded' covers both a ticket refunded after the fact AND
-- a payment the gate refused on arrival (see issue_ticket) — either
-- way the seat is free and the fan's money goes back.
-- ------------------------------------------------------------
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  show_id uuid not null references public.shows (id) on delete restrict, -- sold tickets pin the show
  user_id uuid references public.profiles (id) on delete set null,
  status text not null default 'paid'
    check (status in ('paid', 'checked_in', 'refunded')),
  qr_token text not null unique,
  stripe_payment_intent_id text not null unique,
  amount_cents integer not null,
  buyer_name text,
  purchased_at timestamptz not null default now(),
  checked_in_at timestamptz
);

-- The door list for a show; a fan's own tickets.
create index if not exists tickets_show_id_idx on public.tickets (show_id);
create index if not exists tickets_user_id_idx on public.tickets (user_id);

alter table public.tickets enable row level security;

-- This project grants app roles nothing by default — explicit grants or 42501.
-- Signed-in users may only READ (policies below narrow which rows).
-- Deliberately NO insert / update / delete for authenticated: rows come
-- from the webhook (service role) and the door scan (locked function).
grant select on public.tickets to authenticated;

-- Supabase normally hands service_role everything by default; explicit
-- here so a tightened default can never silently break the webhook.
grant select, insert, update, delete on public.tickets to service_role;
grant select, update on public.profiles to service_role;

drop policy if exists "fans see their own tickets" on public.tickets;
create policy "fans see their own tickets"
  on public.tickets for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "artist sees every ticket" on public.tickets;
create policy "artist sees every ticket"
  on public.tickets for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

-- ------------------------------------------------------------
-- 4 · HOW MANY SOLD. Fans can only see their own rows, so the
-- "12 of 50 left" count needs a definer function. Refunded tickets
-- free their seat; checked-in ones still hold it.
-- ------------------------------------------------------------
create or replace function public.tickets_sold(show uuid)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select count(*)::integer
  from public.tickets t
  where t.show_id = tickets_sold.show
    and t.status in ('paid', 'checked_in');
$$;
revoke execute on function public.tickets_sold(uuid) from public, anon;
grant execute on function public.tickets_sold(uuid) to authenticated;
grant execute on function public.tickets_sold(uuid) to service_role; -- the payment-intent function checks capacity

-- ------------------------------------------------------------
-- 5 · THE TICKET GATE (server only). issue_ticket is the ONLY way a
-- ticket row appears; refund_ticket the only way one is voided.
-- Both are called by the Stripe webhook with the service role.
--
-- issue_ticket is atomic and idempotent: it locks the show row so two
-- payments racing for the last seat serialize, and if Stripe delivers
-- the same payment twice it hands back the row it already made instead
-- of erroring or double-issuing.
--
-- A REFUSAL (the show stopped selling in-app, or filled up, between
-- checkout and the webhook) is recorded rather than raised: the row is
-- written with status 'refunded' and returned. The webhook reads that
-- status and refunds the payment, and because the row carries the
-- payment id, a later retry of the same payment gets the same answer —
-- a refunded payment can never turn into a seat once the show reopens.
-- The one refusal that can't be recorded is a show that no longer
-- exists (the row needs one to point at), so that alone still raises
-- 'Show not found.' — the webhook treats that message as a refusal too.
-- ------------------------------------------------------------
create or replace function public.issue_ticket(
  p_show uuid,
  p_user uuid,
  p_payment_intent text,
  p_amount integer,
  p_buyer_name text
)
returns public.tickets
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s public.shows%rowtype;
  t public.tickets%rowtype;
  sold integer;
  buyer uuid;
  refused boolean := false;
begin
  if p_payment_intent is null or p_payment_intent = '' then
    raise exception 'Missing payment intent.';
  end if;

  -- Serialize every issue for this show (also blocks a concurrent duplicate delivery).
  select * into s from public.shows where id = p_show for update;
  -- The only refusal with nowhere to be written down (tickets.show_id is a
  -- real foreign key). The webhook matches this exact message.
  if s.id is null then raise exception 'Show not found.'; end if;

  -- Already answered for this payment — issued OR refused? Hand that row
  -- back — nothing to do. A refused row stays 'refunded' for good, so a
  -- redelivery after the show reopens can't mint a free ticket.
  select * into t from public.tickets where stripe_payment_intent_id = p_payment_intent;
  if t.id is not null then return t; end if;

  if s.sales_mode <> 'in_app' then
    refused := true; -- sales closed since checkout
  else
    select count(*) into sold
    from public.tickets
    where show_id = p_show and status in ('paid', 'checked_in');
    if s.capacity is not null and sold >= s.capacity then
      refused := true; -- the last seat went while they were paying
    end if;
  end if;

  -- A buyer who deleted their account between paying and this call
  -- still gets a real (ownerless) record, like drop_claims.
  select id into buyer from public.profiles where id = p_user;

  -- One insert for both answers: a seat ('paid') or a recorded refusal
  -- ('refunded' — the webhook refunds; the fan sees why in My Tickets).
  begin
    insert into public.tickets (show_id, user_id, status, qr_token, stripe_payment_intent_id, amount_cents, buyer_name)
    values (
      p_show,
      buyer,
      case when refused then 'refunded' else 'paid' end,
      encode(gen_random_bytes(24), 'hex'),
      p_payment_intent,
      coalesce(p_amount, s.ticket_price_cents, 0),
      nullif(trim(coalesce(p_buyer_name, '')), '')
    )
    returning * into t;
  exception when unique_violation then
    -- Lost a race on the payment-intent key: the other delivery won. Return its row.
    select * into t from public.tickets where stripe_payment_intent_id = p_payment_intent;
  end;
  return t;
end;
$$;
revoke execute on function public.issue_ticket(uuid, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.issue_ticket(uuid, uuid, text, integer, text) to service_role;

-- Stripe says the charge was refunded → the ticket is void (its seat
-- frees up via tickets_sold). Unknown payment id = nothing to do.
create or replace function public.refund_ticket(p_payment_intent text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.tickets
  set status = 'refunded'
  where stripe_payment_intent_id = p_payment_intent
    and status <> 'refunded';
end;
$$;
revoke execute on function public.refund_ticket(text) from public, anon, authenticated;
grant execute on function public.refund_ticket(text) to service_role;

-- ------------------------------------------------------------
-- 6 · THE DOOR SCAN. The artist's scanner sends the QR token (and,
-- when it was opened from a show, that show's id); this answers with:
--   {ok:true,  reason:null, ...}                      → let them in (marked checked_in now)
--   {ok:false, reason:'wrong_show', ...}              → a ticket for another date, or for a
--                                                       show that's cancelled / already over
--   {ok:false, reason:'already_checked_in', checked_in_at, ...}
--   {ok:false, reason:'refunded', ...}
--   {ok:false, reason:'unknown'}                      → not one of ours
-- Every answer carries buyer_name / show_title / status when known.
-- Artist-only (checked inside); the ticket row is locked so two
-- scanners can't both admit the same ticket. A wrong-show refusal
-- never touches the row — the ticket stays good for its own night.
-- ------------------------------------------------------------
-- The earlier one-argument shape must go: with p_show defaulted, a call
-- by name would otherwise match both and Postgres would call it ambiguous.
drop function if exists public.check_in_ticket(text);

create or replace function public.check_in_ticket(p_token text, p_show uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tickets%rowtype;
  s public.shows%rowtype;
  show_title text;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist') then
    raise exception 'Only the artist can check tickets in.';
  end if;

  select * into t
  from public.tickets
  where qr_token = trim(coalesce(p_token, ''))
  for update;
  if t.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  select * into s from public.shows where id = t.show_id;
  show_title := coalesce(nullif(trim(s.title), ''), s.venue);

  -- Wrong door, or a ticket for a show that's cancelled or already wrapped
  -- (doors + 6 hours — the same grace window the app's lists use). Refuse
  -- without updating: nothing about the ticket itself is wrong.
  if (p_show is not null and t.show_id <> p_show)
     or s.status = 'cancelled'
     or s.starts_at + interval '6 hours' < now() then
    return jsonb_build_object(
      'ok', false, 'reason', 'wrong_show',
      'buyer_name', t.buyer_name, 'show_title', show_title, 'status', t.status
    );
  end if;

  if t.status = 'refunded' then
    return jsonb_build_object(
      'ok', false, 'reason', 'refunded',
      'buyer_name', t.buyer_name, 'show_title', show_title, 'status', t.status
    );
  end if;

  if t.status = 'checked_in' then
    return jsonb_build_object(
      'ok', false, 'reason', 'already_checked_in', 'checked_in_at', t.checked_in_at,
      'buyer_name', t.buyer_name, 'show_title', show_title, 'status', t.status
    );
  end if;

  update public.tickets
  set status = 'checked_in', checked_in_at = now()
  where id = t.id;

  return jsonb_build_object(
    'ok', true, 'reason', null, 'checked_in_at', now(),
    'buyer_name', t.buyer_name, 'show_title', show_title, 'status', 'checked_in'
  );
end;
$$;
-- Grants are per signature — these name the new two-argument shape.
revoke execute on function public.check_in_ticket(text, uuid) from public, anon;
grant execute on function public.check_in_ticket(text, uuid) to authenticated;
