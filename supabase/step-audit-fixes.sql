-- ============================================================
-- Audit fixes (2026-09-02): push-token exclusivity + collectible
-- ownership surviving account deletion.
-- Run once in: SQL Editor → New query
-- ============================================================

-- ------------------------------------------------------------
-- FIX 1: one phone, one account's pushes.
-- The old client upsert let the SAME device token sit under every
-- account that ever signed in on that phone — so the device buzzed
-- for all of them. Registering now evicts other accounts' rows for
-- this token (needs definer rights — you can't delete others' rows).
-- ------------------------------------------------------------
create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  if p_platform not in ('ios', 'android') then return; end if;
  delete from public.push_tokens where token = p_token and user_id <> auth.uid();
  insert into public.push_tokens (user_id, token, platform, updated_at)
  values (auth.uid(), p_token, p_platform, now())
  on conflict (user_id, token)
    do update set updated_at = now(), platform = excluded.platform;
end;
$$;
grant execute on function public.register_push_token(text, text) to authenticated;

-- ------------------------------------------------------------
-- FIX 2: a sold number stays sold, even if its owner deletes
-- their account. Cascade used to wipe the claim — putting the
-- number back on the shelf (two owners of "#7 of 50" = disaster).
-- Now the claim survives as "Deleted user": number stays retired,
-- the artist keeps the fulfillment record.
-- ------------------------------------------------------------
alter table public.drop_claims alter column user_id drop not null;
alter table public.drop_claims drop constraint drop_claims_user_id_fkey;
alter table public.drop_claims
  add constraint drop_claims_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete set null;

-- Unfinished checkout holds SHOULD die with the account, though.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if exists (select 1 from public.profiles where id = auth.uid() and role = 'artist') then
    raise exception 'The artist account cannot be deleted from inside the app.';
  end if;
  delete from public.drop_claims where user_id = auth.uid() and status = 'hold';
  delete from auth.users where id = auth.uid();
end;
$$;

-- ------------------------------------------------------------
-- FIX 3: server clock for countdowns. Device clocks drift; drop
-- opens and hold expiries must agree with the database's clock.
-- ------------------------------------------------------------
create or replace function public.server_now()
returns timestamptz
language sql
stable
as $$ select now() $$;
grant execute on function public.server_now() to authenticated;

-- ------------------------------------------------------------
-- FIX 4: start_checkout_hold — switching numbers mid-checkout
-- releases your old hold instead of erroring, and a just-taken
-- number fails with a human sentence, not a constraint name.
-- ------------------------------------------------------------
create or replace function public.start_checkout_hold(p_drop uuid, p_edition int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  hold_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  perform public.purge_expired_holds(p_drop);
  select * into d from public.drops where id = p_drop for update;
  if d is null or not d.is_published then raise exception 'Drop not found.'; end if;
  if now() < d.drops_at then raise exception 'Drop has not opened yet.'; end if;
  if p_edition < 1 or p_edition > d.run_size then raise exception 'No such number.'; end if;
  -- Changing your mind releases the previous reservation.
  delete from public.drop_claims
  where drop_id = p_drop and user_id = auth.uid() and status = 'hold';
  begin
    insert into public.drop_claims (drop_id, user_id, edition_number, status, platform, expires_at)
    values (p_drop, auth.uid(), p_edition, 'hold', 'stripe', now() + interval '10 minutes')
    returning id into hold_id;
  exception when unique_violation then
    raise exception 'That number was just taken — pick another.';
  end;
  return hold_id;
end;
$$;

-- ------------------------------------------------------------
-- FIX 5: claim_edition — validation restored (bounds + open time)
-- and conflicts return NULL instead of throwing, so the payment
-- webhook can auto-refund instead of swallowing money.
-- ------------------------------------------------------------
create or replace function public.claim_edition(p_drop uuid, p_user uuid, p_edition int)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  claim_id uuid;
begin
  perform public.purge_expired_holds(p_drop);
  select * into d from public.drops where id = p_drop for update;
  if d is null or not d.is_published then return null; end if;
  if now() < d.drops_at then return null; end if;
  if p_edition < 1 or p_edition > d.run_size then return null; end if;

  update public.drop_claims
  set status = 'paid', expires_at = null
  where drop_id = p_drop and user_id = p_user and edition_number = p_edition and status = 'hold'
  returning id into claim_id;
  if claim_id is not null then return claim_id; end if;

  begin
    insert into public.drop_claims (drop_id, user_id, edition_number, platform)
    values (p_drop, p_user, p_edition, 'stripe')
    returning id into claim_id;
  exception when unique_violation then
    -- Number or limit lost while paying: webhook must refund. NULL is the signal.
    return null;
  end;
  return claim_id;
end;
$$;

-- ------------------------------------------------------------
-- FIX 6: mark-shipped becomes ONE atomic step (tracking + status
-- together) — no more half-shipped states from a dropped request.
-- Artist-only, checked inside.
-- ------------------------------------------------------------
create or replace function public.mark_claim_shipped(p_claim uuid, p_tracking text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist') then
    raise exception 'Only the artist can mark orders shipped.';
  end if;
  insert into public.drop_fulfillment (claim_id, tracking, shipped_at)
  values (p_claim, nullif(trim(p_tracking), ''), now())
  on conflict (claim_id)
    do update set tracking = excluded.tracking, shipped_at = coalesce(drop_fulfillment.shipped_at, now());
  update public.drop_claims set status = 'shipped' where id = p_claim;
end;
$$;
grant execute on function public.mark_claim_shipped(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- FIX 7: the drop-publish push no longer pings the artist's own
-- phone about their own drop.
-- ------------------------------------------------------------
create or replace function public.push_on_drop_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  msgs jsonb;
begin
  if old.is_published or not new.is_published then return new; end if;
  select jsonb_agg(jsonb_build_object(
    'to', pt.token,
    'title', case when new.project = 's333xgod' then 'S333XGOD' else 'MAZZE' end || ' DROP',
    'body', new.title || ' · ' || new.run_size || ' numbered. Gone when they''re gone.',
    'sound', 'default'
  ))
  into msgs
  from public.push_tokens pt
  join public.profiles pr on pr.id = pt.user_id and pr.role <> 'artist'
  left join public.notification_prefs np on np.user_id = pt.user_id
  where coalesce(np.new_posts, true);
  if msgs is not null then perform public.send_expo_push(msgs); end if;
  return new;
end;
$$;
