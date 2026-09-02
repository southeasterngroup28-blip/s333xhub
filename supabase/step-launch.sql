-- ============================================================
-- Launch infrastructure: tappable pushes + in-house crash log.
-- Run once in: SQL Editor → New query
-- ============================================================

-- ------------------------------------------------------------
-- 1) Every push now carries the screen it should open. Tapping
--    "MAZZE just dropped" lands on that post, a DM push opens
--    that chat, a drop push opens the drop.
-- ------------------------------------------------------------
create or replace function public.push_on_new_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  msgs jsonb;
  drop_title text;
begin
  begin
    drop_title := case when new.project = 's333xgod' then 'S333XGOD' else 'MAZZE' end
      || ' just dropped';
    select jsonb_agg(jsonb_build_object(
      'to', pt.token,
      'title', drop_title,
      'body', coalesce(
        nullif(new.title, ''),
        nullif(left(new.body, 120), ''),
        case new.kind
          when 'audio' then 'New track in the app'
          when 'video' then 'New video in the app'
          when 'poll' then 'New poll — cast your vote'
          else 'Open S333XHUB to see it'
        end
      ),
      'sound', 'default',
      'data', jsonb_build_object('url', '/post/' || new.id)
    ))
    into msgs
    from public.push_tokens pt
    left join public.notification_prefs np on np.user_id = pt.user_id
    where pt.user_id <> new.author_id
      and coalesce(np.new_posts, true);
    if msgs is not null then perform public.send_expo_push(msgs); end if;
  exception when others then
    raise warning 'post push failed: %', sqlerrm;
  end;
  return new;
end;
$$;

create or replace function public.push_on_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  msgs jsonb;
  room_type text;
  sender_name text;
  preview text;
begin
  begin
    select c.type into room_type from public.channels c where c.id = new.channel_id;
    select p.display_name into sender_name from public.profiles p where p.id = new.sender_id;
    preview := case new.kind
      when 'gif' then 'sent a GIF'
      when 'voice' then 'sent a voice note'
      when 'image' then 'sent a photo'
      else left(new.body, 120)
    end;
    select jsonb_agg(jsonb_build_object(
      'to', pt.token,
      'title', case when room_type = 'group' then 'S333XHUB' else coalesce(sender_name, 'New message') end,
      'body', case when room_type = 'group'
        then coalesce(sender_name, 'Someone') || ': ' || preview
        else preview end,
      'sound', 'default',
      'data', jsonb_build_object('url', '/channel/' || new.channel_id)
    ))
    into msgs
    from public.channel_members cm
    join public.push_tokens pt on pt.user_id = cm.user_id
    left join public.notification_prefs np on np.user_id = cm.user_id
    where cm.channel_id = new.channel_id
      and cm.user_id <> new.sender_id
      and cm.muted_at is null
      and cm.left_at is null
      and case when room_type = 'group'
        then coalesce(np.group_chat, true)
        else coalesce(np.dms, true) end;
    if msgs is not null then perform public.send_expo_push(msgs); end if;
  exception when others then
    raise warning 'message push failed: %', sqlerrm;
  end;
  return new;
end;
$$;

create or replace function public.push_on_drop_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  msgs jsonb;
begin
  begin
    if old.is_published or not new.is_published then return new; end if;
    select jsonb_agg(jsonb_build_object(
      'to', pt.token,
      'title', case when new.project = 's333xgod' then 'S333XGOD' else 'MAZZE' end || ' DROP',
      'body', new.title || ' · ' || new.run_size || ' numbered. Gone when they''re gone.',
      'sound', 'default',
      'data', jsonb_build_object('url', '/drop/' || new.id)
    ))
    into msgs
    from public.push_tokens pt
    join public.profiles pr on pr.id = pt.user_id and pr.role <> 'artist'
    left join public.notification_prefs np on np.user_id = pt.user_id
    where coalesce(np.new_posts, true);
    if msgs is not null then perform public.send_expo_push(msgs); end if;
  exception when others then
    raise warning 'drop push failed: %', sqlerrm;
  end;
  return new;
end;
$$;

create or replace function public.push_on_claim_shipped()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  msgs jsonb;
  d record;
begin
  begin
    if new.status <> 'shipped' or old.status = 'shipped' then return new; end if;
    select * into d from public.drops where id = new.drop_id;
    select jsonb_agg(jsonb_build_object(
      'to', pt.token,
      'title', 'Your piece shipped 📦',
      'body', d.title || ' #' || new.edition_number || ' is on the way.',
      'sound', 'default',
      'data', jsonb_build_object('url', '/drop/' || new.drop_id)
    ))
    into msgs
    from public.push_tokens pt
    where pt.user_id = new.user_id;
    if msgs is not null then perform public.send_expo_push(msgs); end if;
  exception when others then
    raise warning 'shipped push failed: %', sqlerrm;
  end;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 2) In-house crash log: fatal app errors land here, owned by us,
--    readable in the dashboard (and by the artist later if wanted).
-- ------------------------------------------------------------
create table public.client_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  message text not null,
  stack text,
  fatal boolean not null default true,
  platform text,
  app_version text,
  created_at timestamptz not null default now()
);

alter table public.client_errors enable row level security;
grant insert on public.client_errors to authenticated;

create policy "users file their own crash reports"
  on public.client_errors for insert to authenticated
  with check (user_id is null or user_id = auth.uid());
-- No select policy for app roles: reports are read via the dashboard.
