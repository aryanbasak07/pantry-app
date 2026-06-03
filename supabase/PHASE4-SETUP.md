# Phase 4 setup — morning push notifications

## 1. Add the subscriptions table
- Supabase → **SQL Editor** → paste `supabase/phase4.sql` → **Run**.

## 2. Set Vercel environment variables
**Vercel → your project → Settings → Environment Variables** (Production), add:

| Name | Value |
|------|-------|
| `VAPID_PUBLIC_KEY` | `BF4q-q4-4p5hTFMq3fCsvp-C3_F6bTKcRXC2LtRBhyJs18QuOXaPzSTP1fIg3eJi-N93RX4JPZdpETcK2f20o0A` |
| `VAPID_PRIVATE_KEY` | *(the private key — sent to you in chat, keep secret)* |
| `VAPID_SUBJECT` | `mailto:you@example.com` (your email) |
| `SUPABASE_URL` | `https://bitdzdfpzvvilhymvsio.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → **service_role** secret |
| `CRON_SECRET` | any long random string (Vercel sends it to protect the cron) |

Then **Redeploy** so the function and cron pick up the values.

> The **service_role** key and **VAPID_PRIVATE_KEY** are powerful secrets — they live only
> in Vercel's server environment, never in the app or the repo.

## 3. The schedule
`vercel.json` runs `/api/cron-morning` daily at **02:30 UTC = 08:00 IST**. Change the
`crons.schedule` (UTC cron) if you're in another timezone — tell me your timezone and I'll set it.

## 4. Turn it on (each phone)
Open the app → **⚙️ Settings → 🔔 Morning alerts** → toggle on → allow notifications.
- **iPhone:** add the app to your Home Screen first (Web Push only works for installed PWAs on iOS 16.4+).
- **Android:** works once permission is granted.

Each morning, every phone that's opted in gets: **"N items need attention today"** — only when N > 0.

## Verify
Reply once the env vars are set + redeployed and I'll trigger `/api/cron-morning`
manually (with the cron secret) to confirm the whole pipeline before you rely on it.
