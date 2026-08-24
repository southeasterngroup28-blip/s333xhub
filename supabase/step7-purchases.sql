-- ============================================================
-- S333XHUB — Step 7a: purchases + real server-side lock enforcement
-- Run once in: SQL Editor → New query
-- ============================================================

-- Who has unlocked which post, forever. Rows will be written by the
-- payment system (RevenueCat webhook) once Apple approves the account;
-- until then 'manual' rows can be inserted from the dashboard for testing.
create table public.purchases (
  user_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  platform text not null default 'manual' check (platform in ('manual', 'apple', 'google')),
  product_id text,
  purchased_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

alter table public.purchases enable row level security;

-- Users can see their own purchases. There is deliberately NO insert
-- grant: purchase rows only come from trusted server code (or the
-- dashboard) — an app can never write its own "I paid" row.
grant select on public.purchases to authenticated;

create policy "users see own purchases"
  on public.purchases for select to authenticated
  using (user_id = auth.uid());

-- ============================================================
-- THE VAULT SEAL. Until now, locked media was hidden by the app but the
-- storage rule allowed any signed-in user to mint a link. From here on,
-- storage itself checks: artist? free post? or a purchase row? Otherwise
-- the file is not served — no matter what any client does.
-- Files are stored as "<post id>/<filename>", so the top folder of the
-- path identifies the post.
-- ============================================================
drop policy "signed-in users can read post files" on storage.objects;

create policy "post files respect locks"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'post-media'
    and (
      exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'artist')
      or exists (
        select 1 from public.posts po
        where po.id::text = (storage.foldername(name))[1]
          and (
            not po.is_locked
            or exists (
              select 1 from public.purchases pu
              where pu.post_id = po.id and pu.user_id = auth.uid()
            )
          )
      )
    )
  );
