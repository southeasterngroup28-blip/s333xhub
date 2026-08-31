-- ============================================================
-- S333XHUB — Push delivery: the database itself notifies phones.
-- New post → everyone (who wants them). New message → the room.
-- Uses pg_net to call Expo's push service directly — no servers.
-- Run once in: SQL Editor → New query
-- ============================================================

create extension if not exists pg_net;

-- Sends one batch of pushes to Expo. Chunks of 90 keep each HTTP
-- call under Expo's 100-message limit.
create or replace function public.send_expo_push(messages jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  total int := coalesce(jsonb_array_length(messages), 0);
  i int := 0;
begin
  while i < total loop
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := (
        select jsonb_agg(value)
        from jsonb_array_elements(messages) with ordinality as t(value, ord)
        where ord > i and ord <= i + 90
      )
    );
    i := i + 90;
  end loop;
end;
$$;

-- ============================================================
-- New post → push every fan who hasn't turned "New posts" off.
-- ============================================================
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
    'sound', 'default'
  ))
  into msgs
  from public.push_tokens pt
  left join public.notification_prefs np on np.user_id = pt.user_id
  where pt.user_id <> new.author_id
    and coalesce(np.new_posts, true);

  if msgs is not null then
    perform public.send_expo_push(msgs);
  end if;
  return new;
end;
$$;

create trigger on_post_created_push
  after insert on public.posts
  for each row execute function public.push_on_new_post();

-- ============================================================
-- New chat message → push the rest of the room.
-- Respects mute, leave, and the group/DM notification switches.
-- ============================================================
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
    'sound', 'default'
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

  if msgs is not null then
    perform public.send_expo_push(msgs);
  end if;
  return new;
end;
$$;

create trigger on_message_created_push
  after insert on public.messages
  for each row execute function public.push_on_new_message();
