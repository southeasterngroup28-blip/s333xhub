-- ============================================================
-- Fan Mail is free — with a rhythm: ONE submission per fan per week.
-- Enforced by the database itself, so no client trick gets around it.
-- Run once in: SQL Editor → New query
-- ============================================================
drop policy "send fan mail as yourself" on public.fan_mail;

create policy "send fan mail as yourself, once a week"
  on public.fan_mail for insert to authenticated
  with check (
    user_id = auth.uid()
    and not exists (
      select 1 from public.fan_mail existing
      where existing.user_id = auth.uid()
        and existing.created_at > now() - interval '7 days'
    )
  );
