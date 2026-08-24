-- ============================================================
-- S333XHUB — Fan Mail goes email-only (nothing displays in-app)
-- Run once in: SQL Editor → New query
-- ============================================================

-- The artist no longer reads fan mail in the app; senders see only
-- their own submission history (no content).
drop policy "senders and the artist see fan mail" on public.fan_mail;
create policy "senders see their own fan mail"
  on public.fan_mail for select to authenticated
  using (user_id = auth.uid());

drop policy "artist marks fan mail reviewed" on public.fan_mail;
revoke update on public.fan_mail from authenticated;

drop policy "fan mail readable by sender and artist" on storage.objects;
create policy "fan mail readable by its sender"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'fan-mail'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
