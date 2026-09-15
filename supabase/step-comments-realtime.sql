-- ============================================================
-- Live comments (feel pass 2): broadcast new post_comments rows
-- to connected apps so an open thread updates without a refresh.
-- Without this the app's comment subscription is a silent no-op.
-- The app refetches each row after the event, so RLS still applies.
-- Run in the Supabase SQL editor.
-- ============================================================
alter publication supabase_realtime add table public.post_comments;
