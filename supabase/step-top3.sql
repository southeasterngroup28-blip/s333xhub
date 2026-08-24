-- ============================================================
-- S333XHUB — Top 8 becomes Top 3
-- Run once in: SQL Editor → New query
-- ============================================================
delete from public.top_fans where position > 3;
alter table public.top_fans drop constraint if exists top_fans_position_check;
alter table public.top_fans add constraint top_fans_position_check
  check (position between 1 and 3);
