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

## 3. Turn on anonymous sessions (no login!)
- **Authentication → Sign In / Providers → Anonymous Sign-Ins** → enable it.
- This lets the app create a silent, password-free session on each phone. You never
  see a login screen. Your data stays private because only phones that have joined
  your kitchen (via the pairing code) can read it.

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
- **No login screen.** The app signs in silently in the background.
- First phone: tap **Create our kitchen** → you get a 6-char pairing code.
- Second phone: tap **Join**, type the code once → you're now sharing one list.
- After that: when either of you checks off, adds, or uses an item, it appears on the
  other phone **instantly** (realtime sync). Works offline too and syncs when back online.

Your existing on-device items aren't lost — I'll add a one-tap "import my current items
into our shared kitchen" step on first sign-in.
