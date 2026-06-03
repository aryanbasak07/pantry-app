# Phase 3 setup — bill OCR + spend

Two quick things on your side, then I verify and we're live.

## 1. Add the receipts table
- Supabase → **SQL Editor** → paste `supabase/phase3.sql` → **Run**.

## 2. Get a free Gemini API key + give it to Vercel (server-side)
- Go to **https://aistudio.google.com/apikey** → **Create API key** (free, no billing).
- In **Vercel** → your project → **Settings → Environment Variables**:
  - Name: `GEMINI_API_KEY`
  - Value: *(paste the key)*
  - Apply to **Production** (and Preview) → **Save**.
- Then **redeploy** (Vercel → Deployments → ⋯ → Redeploy) so the function picks up the key.

The key lives only on Vercel's servers — it is never sent to the phone or committed to the repo.

## Then tell me "key is set"
I'll hit `/api/parse-receipt` to confirm the function + key work, and you can scan your
first bill: **Spend tab → Scan a bill** → snap the receipt → review the parsed items
and total → **Save spend** (tick any items to also drop into your inventory).
