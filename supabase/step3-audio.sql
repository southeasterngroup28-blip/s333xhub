-- ============================================================
-- S333XHUB — Step 3: audio posts
-- Run once in: SQL Editor → New query
-- ============================================================

-- Track title for audio posts (photos/text leave it empty).
alter table public.posts add column title text;
