-- ============================================================
-- S333XHUB — Fix reactions + Fan Mail
-- Run once in: SQL Editor → New query
-- ============================================================

-- FIX: the emoji allow-list got garbled by clipboard encoding, so every
-- reaction was rejected. The app controls the emoji set; drop the check.
alter table public.post_reactions drop constraint if exists post_reactions_emoji_check;

-- ------------------------------------------------------------
-- Fan Mail: fans submit pictures, video, beats, or music to the
-- artist. $10 per submission (the charge activates with the App
-- Store build — `paid` stays false until then).
-- ------------------------------------------------------------
create table public.fan_mail (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('picture', 'video', 'audio')),
  storage_path text not null,
  note text check (char_length(note) <= 500),
  paid boolean not null default false,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index fan_mail_created_idx on public.fan_mail (created_at desc);

alter table public.fan_mail enable row level security;
grant select, insert on public.fan_mail to authenticated;
grant update (reviewed_at) on public.fan_mail to authenticated;

create policy "senders and the artist see fan mail"
  on public.fan_mail for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist')
  );

create policy "send fan mail as yourself"
  on public.fan_mail for insert to authenticated
  with check (user_id = auth.uid());

create policy "artist marks fan mail reviewed"
  on public.fan_mail for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist'));

-- Private bucket; each fan uploads into their own folder.
insert into storage.buckets (id, name, public) values ('fan-mail', 'fan-mail', false);

create policy "fans upload into their own fan-mail folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'fan-mail'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "fan mail readable by sender and artist"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'fan-mail'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist')
    )
  );
