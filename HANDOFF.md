# S333XHUB — Build Handoff

You are continuing an existing, working project. **Do not start from scratch.** The code
lives in this folder (`C:\dev\s333xhub`), steps 1–4 are built and verified on a real
iPhone, and this document is the complete state of the world. Read it fully before
touching anything.

## Who you're working with

The user is a **beginner**. Explain what you're doing in plain English as you go, and
stop them before bad decisions (🛑-style callouts). Give exact copy-paste instructions
for anything they must do in a dashboard. They test on an iPhone via Safari (see
"How testing works").

## What this app is

A private mobile app (iOS + Android, React Native + Expo) for ONE independent musician
who releases under two names: **Mazze** and **S333XGOD**. One shared fanbase, one feed.

- Fans: free accounts, never a subscription. They read the feed, stream full audio,
  view photos/video, chat, and pay ~$5–20 to permanently unlock individual locked posts.
- Artist: the only account that can post. Picks per post: which project name it's under,
  whether it's locked, and the price (preset Apple tiers only).
- The killer feature is real audio streaming: play/pause/scrub now; background playback
  + lock-screen controls once there's a dev build.

## Non-negotiable constraints (do not change these, ever)

1. **45-second hard cap on video**, enforced before upload. It's a bandwidth-cost control.
2. **No subscriptions.** Pay-per-item only.
3. **All media in a PRIVATE storage bucket**, served via short-lived signed URLs.
4. Artist-only posting and role changes enforced **in the database** (RLS + column
   grants), never only in the client.
5. Apple compliance built as features, not retrofitted: block user, report content/user,
   admin delete, account deletion (in-app AND a public web URL), ToS/privacy acceptance
   at signup (done), per-type push opt-out, EULA, profanity filter on chat, a report
   queue the owner can act on within 24h.
6. Build for a few hundred users; don't over-engineer, but no choices that force a
   rewrite at 5,000.
7. Before writing ANY payment code: present the user the IAP options (StoreKit direct
   vs RevenueCat vs US external-link entitlement) with pros/cons/fees and WAIT for
   their choice. Remind them to enroll in the App Store Small Business Program (15%)
   the day their Apple Developer account activates — they must do it themselves.

## Current state (verified on device 2026-08-17)

- **Step 1 — Auth**: email+password (deliberate: avoids Sign in with Apple requirement),
  sign-up with required ToS checkbox, profiles table with `role` ('fan'|'artist').
  Artist account: `oficialrm8@gmail.com` (display name "Rickytest"). Fan test account:
  `alaverga@gmail.com`. A junk unconfirmed account `s333xhub.test.account@gmail.com`
  exists; ignore or delete. Email confirmation is currently ON in Supabase.
- **Step 2 — Feed**: single combined feed (artist decision: NO tabs, NO filter — one
  fanbase). Newest first, pull-to-refresh, infinite scroll. Per-post project symbol
  next to the author name, Twitter-checkmark style: blue "disc" Ionicon = Mazze,
  red "flame" = S333XGOD (placeholders; artist hasn't picked finals). Artist sees a
  white + FAB; compose has a MAZZE/S333XGOD picker, text, photos (max 4), audio, video.
- **Step 3 — Audio**: upload via compose, plays in a card (play/pause, tap-to-scrub
  progress bar, elapsed/total). One global player (new track stops the old one).
  `expo-audio`; audio mode set for silent-switch playback + background (background
  needs a dev build to verify). `UIBackgroundModes: ["audio"]` already in app.json.
- **Step 4 — Video**: 45s cap + 50MB cap enforced at pick time with human error
  messages. Plays via `expo-video` with native controls.
- **Locked posts (built early at user request)**: compose has a lock toggle + price
  chips ($4.99/$9.99/$14.99/$19.99 — preset because Apple IAP requires price points).
  Fans see a gold lock card ("Unlock for $X — coming soon") and their client never
  requests signed URLs for locked media. ⚠️ NOT server-enforced until step 7 — the
  artist knows not to post precious material locked yet.

## Environment & how testing works

- Node 24, git (repo initialized, checkpoint commit `f728cd8` = verified steps 1–4).
- **No Mac.** Windows PC + iPhone. The user's Apple Developer enrollment is PENDING
  (Apple ID `icywinnie98@icloud.com`). Until approved there is NO native testing:
  App Store Expo Go is frozen at SDK 54 and this is SDK 57. When approval lands,
  use `npx eas-cli@latest go` (Expo Go via user's TestFlight) or a dev build.
- Testing surface today: **web over LAN**. Start with:
  `cd C:\dev\s333xhub && npx expo start --web` — user opens `http://<PC-IP>:8081`
  in iPhone Safari (get IP via `Get-NetIPAddress`; it was 192.168.1.119).
- ⚠️ **After installing any package or changing app.json: kill the dev server and
  restart with `npx expo start --web -c`.** A stale Metro serves broken bundles that
  fail SILENTLY (cost us hours once).
- ⚠️ **File pickers on web must be real HTML `<input type="file">` elements**
  (see `src/components/media-pickers.web.tsx`). iPhone Safari refuses the simulated
  clicks that expo-image-picker/document-picker use on web. Native picker variants
  (`media-pickers.tsx`) are correct but untested until a dev build exists.
- Typecheck after every change: `npx tsc --noEmit`. Keep it clean.

## Supabase (the backend)

- Project URL + publishable key are in `.env` (already correct; gitignored).
- The user runs SQL in the dashboard SQL Editor (they can't be automated; give them
  exact paste-ready scripts and save each as `supabase/stepN-*.sql`).
- Already executed, in order: `schema.sql`, `step2-feed.sql`, `step2b-grants.sql`,
  `step3-audio.sql`, `step-locks.sql`, `step4-video.sql`.
- ⚠️ **This is a new-generation Supabase project: app roles get ZERO table access by
  default.** Every new table needs explicit `grant select/insert/... to authenticated`
  ALONGSIDE its RLS policies, or you get 42501 "permission denied". Anon gets nothing
  (intentional — every screen requires login).
- Schema: `profiles(id→auth.users, display_name, role, accepted_tos_at)` — role is
  column-grant-locked; `posts(author_id, project, kind text|photo|audio|video, body,
  title, is_locked, price_cents, created_at)`; `post_media(post_id, storage_path,
  media_type, width, height, duration_seconds, position)`. Storage bucket `post-media`
  (private). A trigger auto-creates profiles on signup and stamps ToS acceptance.
- Supabase errors are NOT `Error` instances — surface `(e as {message?:string})?.message`
  or errors become invisible "Something went wrong".

## Remaining work: steps 5–9

Get each step working on the user's phone (Safari) before the next. Keep saving
decisions and gotchas to your memory directory if you have one.

### Step 5 — Chat
Original requirements (the artist may refine later; these stand for now):
- One **group chat** for the whole community. Every new user auto-enrolled at signup.
  Must be able to MUTE it and LEAVE it (Apple requires this); leaving ≠ leaving the app.
- **1:1 DMs** between each fan and the artist. DEFAULT (artist away): any fan may DM
  the artist first; group chat is always-on. Mark as reversible.
- Schema must support later splitting into multiple channels and rate limiting
  WITHOUT a rewrite — e.g. `channels(id, type 'group'|'dm', created_at)`,
  `channel_members(channel_id, user_id, muted_at, left_at, last_read_at)`,
  `messages(id, channel_id, sender_id, body, created_at, deleted_at)`. Don't build
  multi-channel UI now.
- Use Supabase Realtime for live updates. Unread badges nice-to-have, not required.
- A simple profanity filter on send (word list is fine) — Apple wants filtering to exist.

### Step 6 — Moderation
- Block a user (blocks hide each other's messages; blocked fan can't DM artist).
- Report content + report users → `reports` table.
- Artist/admin: delete any message or post (soft-delete `deleted_at`), and an admin
  screen listing open reports (their 24h-action queue).
- Account deletion: in-app button (delete auth user via edge function or dashboard
  instructions) + note that Google Play needs a public web deletion-request URL by
  submission time.

### Step 7 — Paid unlocks (the money step)
- FIRST: the IAP options conversation (see constraint 7). Wait for the user's choice.
- `purchases(user_id, post_id, product_id, platform, purchased_at)` table.
- Server-side enforcement: storage select policy (or an edge function issuing signed
  URLs) checks `is_locked = false OR a purchases row exists for auth.uid()`.
  This is the moment locked content becomes actually sealed.
- Map the price tiers to App Store Connect products. **Restore Purchases button is
  mandatory.** Locked-post UI already exists — wire it to real purchases.

### Step 8 — Push notifications
- Expo push. Per-type opt-out toggles (new post, group chat, DMs) in a settings screen.
- App must work fully if permission is denied.

### Step 9 — Polish + submission
- Turn email confirmation back ON with proper deep links.
- Real ToS + privacy policy documents + EULA; public support contact; account-deletion
  web page; privacy nutrition labels; age rating (expect 17+); store listing name
  decision (S333XGOD as a store name may cause rating/review friction — the plan is
  possibly a neutral store name with S333XGOD inside).
- Full compliance sweep against constraint 5. EAS production builds. TestFlight to the
  artist, then submission.

## Design defaults while the artist is away (ALL reversible — flag them as such)

- Keep the current look: black background, white text, gold (#fbbf24) for lock/paid
  accents, minimal chrome. Vibe reference was never answered — do not redesign.
- Music posts stay **player-first** (clean card, no cover art). Do NOT add a cover-art
  column casually — that's an open artist question with schema impact.
- Project symbols stay disc/flame placeholders.
- Chat defaults as in step 5 above.

## Things only the user can do (ask, don't attempt)

- Anything in the Supabase or Apple dashboards (give exact steps).
- Testing on the phone (give a numbered test checklist per step).
- Apple Developer enrollment status; Small Business Program enrollment.
- Choosing the IAP route at step 7.

## Git

Commit at each verified milestone with a clear message. `f728cd8` is the restore point
for "the version before default-mode" — if the artist wants different choices, branch
from there rather than undoing by hand.
