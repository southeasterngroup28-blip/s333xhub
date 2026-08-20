-- ============================================================
-- S333XHUB — Step 4: video posts
-- Run once in: SQL Editor → New query
-- ============================================================

-- Length of audio/video files, in seconds. The app enforces the
-- 45-second video cap at upload time; this records what was measured.
alter table public.post_media add column duration_seconds integer;
