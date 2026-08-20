-- ============================================================
-- S333XHUB — Fix: grant table access to signed-in users.
-- New Supabase projects give app users NO table access by default;
-- these grants open the door, and the row-level security policies
-- (already in place) still decide which rows each user can touch.
-- Run once in: SQL Editor → New query
-- ============================================================

-- Signed-in users can read profiles; can change only their own
-- display_name (RLS restricts to own row, column grant restricts to that column).
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

-- Feed tables. RLS still enforces: everyone reads, only the artist writes.
grant select, insert, delete on public.posts to authenticated;
grant select, insert, delete on public.post_media to authenticated;

-- Note: logged-out visitors (the "anon" role) get nothing — intentional.
-- Every screen in this app requires an account.
