-- ============================================================
-- S333XHUB — Chat media: GIFs + voice notes for everyone,
-- pictures for the artist only.
-- Run once in the Supabase dashboard: SQL Editor → New query
-- ============================================================

-- What kind of message each row is. Existing rows stay 'text'.
alter table public.messages
  add column kind text not null default 'text'
    check (kind in ('text', 'gif', 'voice', 'image')),
  add column media_path text,       -- storage path for voice/image files
  add column media_url text,        -- external URL for GIFs (Tenor)
  add column duration_seconds numeric; -- voice note length, for the bubble

-- Media messages have no typed text, so the old "body must be 1-2000
-- chars" rule only applies to text messages now.
alter table public.messages drop constraint messages_body_check;
alter table public.messages
  add constraint messages_body_check
    check (char_length(body) <= 2000 and (kind <> 'text' or char_length(body) >= 1));

-- Belt-and-braces: only the artist may send picture messages.
-- (The app hides the button for fans; this makes the server agree.)
drop policy "members can send messages" on public.messages;
create policy "members can send messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.can_post_in(channel_id)
    and (
      kind <> 'image'
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist')
    )
  );

-- ============================================================
-- Private bucket for chat voice notes and pictures.
-- Files live at:  <sender user id>/<channel id>/<filename>
-- ============================================================
insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', false)
on conflict (id) do nothing;

-- You may upload only into YOUR OWN folder, and only for a channel
-- you can post in.
create policy "chat members upload own media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.can_post_in(((storage.foldername(name))[2])::uuid)
  );

-- You may view a file only if you're a member of the channel it
-- belongs to (the channel id is the second folder in the path).
create policy "chat members read channel media"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-media'
    and public.is_channel_member(((storage.foldername(name))[2])::uuid)
  );
