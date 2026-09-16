-- ============================================================
-- De-AI pass: shipped data and defaults. Run once in the Supabase
-- SQL Editor (New query). Nothing here is destructive; every
-- statement re-declares something that already exists.
--
-- 1) No fan is ever named 'fan'. The column default and the sign-up
--    trigger fall back to '' and the app forces a real name on first
--    open (src/app/name.tsx). Not raised in the trigger, not derived
--    from the email.
-- 2) Push copy: no 'in the app', no 'cast your vote', no emoji, no
--    'Someone'; the shipped push is titled 'Shipped'; the show push
--    names the show or the city and reads its month AP style ('Sept 6').
--
-- The canonical function bodies live in step-launch.sql (posts,
-- messages, shipped) and step-shows.sql (shows); this file mirrors them
-- so the live database can be brought up to date in one run.
-- ============================================================

-- ---- 1) the placeholder name ----------------------------------------

alter table public.profiles alter column display_name set default ''; -- app forces a name on first open

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, accepted_tos_at)
  values (
    new.id,
    -- '' when sign-up sent no name: the app forces a name on first open.
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), ''),
    now()
  );
  return new;
end;
$$;

-- Rows that still carry the old placeholder get routed to the name
-- screen on their next open (the app treats 'fan' and '' the same), so
-- no data rewrite is needed here.

-- ---- 2) push copy -----------------------------------------------------

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
          when 'audio' then 'New track'
          when 'video' then 'New video'
          when 'poll' then 'New poll'
          when 'photo' then 'New photo'
          else 'New post'
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
      'title', case when room_type = 'group' then 'S333XHUB' else coalesce(sender_name, 'Deleted user') end,
      'body', case when room_type = 'group'
        then coalesce(sender_name, 'Deleted user') || ': ' || preview
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
      'title', 'Shipped',
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

create or replace function public.push_on_show_announced()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  msgs jsonb;
  local_at timestamp;
  when_label text;
begin
  begin
    -- Only a fresh, future announcement is news. Back-filling an old
    -- date for the archive, or adding a sold-out/cancelled row, stays quiet.
    if new.status <> 'announced' or new.starts_at < now() then return new; end if;
    -- The venue's own wall clock; a bad zone name falls back to UTC
    -- rather than losing the push.
    begin
      local_at := new.starts_at at time zone new.timezone;
    exception when others then
      local_at := new.starts_at at time zone 'UTC';
    end;
    -- "Sept 6", AP style, the way the chat and the ticket read a date.
    when_label := case extract(month from local_at)
      when 3 then 'March'
      when 4 then 'April'
      when 6 then 'June'
      when 7 then 'July'
      when 9 then 'Sept'
      else to_char(local_at, 'Mon')
    end || ' ' || extract(day from local_at)::int;
    select jsonb_agg(jsonb_build_object(
      'to', pt.token,
      -- A named show is the title and the city joins the body; otherwise
      -- the city is the title.
      'title', coalesce(nullif(new.title, ''), new.city),
      'body', case
        when nullif(new.title, '') is null then new.venue || ' · ' || when_label
        else new.city || ' · ' || new.venue || ' · ' || when_label
      end,
      'sound', 'default',
      'data', jsonb_build_object('url', '/shows')
    ))
    into msgs
    from public.push_tokens pt
    join public.profiles pr on pr.id = pt.user_id and pr.role <> 'artist'
    left join public.notification_prefs np on np.user_id = pt.user_id
    where coalesce(np.shows, true);
    if msgs is not null then perform public.send_expo_push(msgs); end if;
  exception when others then
    raise warning 'show push failed: %', sqlerrm;
  end;
  return new;
end;
$$;
