-- ============================================================
-- S333XHUB — Cover framing: which vertical slice of the cover shows
-- (0 = top of the image, 0.5 = center, 1 = bottom)
-- Run once in: SQL Editor → New query
-- ============================================================
alter table public.posts add column cover_focus real not null default 0.5;
grant update (cover_focus) on public.posts to authenticated;
