# Phase 2 setup — make the app shared (Supabase)

This takes ~5 minutes. You do steps 1–4; then send me two values and I wire + test the sync.

## 1. Create a free Supabase project
- Go to https://supabase.com → sign in → **New project**.
- Name it (e.g. `pantry`), pick a region near you, set a database password (save it somewhere).
- Wait ~2 min for it to provision.

## 2. Create the database
- In the project: **SQL Editor** → **New query**.
- Open `supabase/schema.sql` from this repo, copy all of it, paste, click **Run**.
- You should see "Success. No rows returned." That builds the tables, security rules, and the create/join-household functions.

## 3. Turn on email login (magic links)
- **Authentication → Providers → Email**: make sure it's enabled (it is by default).
- That's it — no passwords. You each log in by clicking a link sent to your email.

## 4. Copy two values for me
- **Project Settings → API**, copy:
  - **Project URL** (looks like `https://abcd1234.supabase.co`)
  - **anon public** key (a long `eyJ...` string)
- These two are *safe to put in the frontend* — the anon key is public by design, and the
  database security rules (RLS) make sure each household only sees its own data.

## Then send me:
```
SUPABASE_URL = https://....supabase.co
SUPABASE_ANON_KEY = eyJ....
```

## What happens after that (I build & test it)
- A **login screen** (enter email → click the magic link).
- First time in: **Create our kitchen** → you get a 6-char invite code.
- Your girlfriend logs in, taps **Join**, enters the code → you're now sharing one list.
- After that: when either of you checks off, adds, or uses an item, it appears on the
  other phone **instantly** (realtime sync). Works offline too and syncs when back online.

Your existing on-device items aren't lost — I'll add a one-tap "import my current items
into our shared kitchen" step on first sign-in.
