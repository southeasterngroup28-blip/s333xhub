-- ============================================================
-- S333XHUB — Locked posts (pay-per-unlock groundwork)
-- Run once in: SQL Editor → New query
-- Payments themselves arrive in step 7; this stores the artist's
-- per-post choice of locked-or-not and the unlock price.
-- ============================================================

alter table public.posts add column is_locked boolean not null default false;
alter table public.posts add column price_cents integer;

-- A locked post must have a sane price (at least $0.99).
alter table public.posts add constraint locked_posts_have_price
  check (not is_locked or price_cents >= 99);
