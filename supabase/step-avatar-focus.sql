-- ============================================================
-- S333XHUB — Avatar framing: remember which part of the photo
-- shows inside the circle (0 = top/left … 1 = bottom/right).
-- Run once in: SQL Editor → New query
-- ============================================================
alter table public.profiles add column avatar_focus numeric not null default 0.5;
grant update (avatar_focus) on public.profiles to authenticated;
