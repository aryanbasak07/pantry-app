# Pantry & Spend — MVP Plan

A shared mobile app for two people to manage groceries: a shopping list, a
freshness/expiry tracker, morning notifications, and spend tracking via
photographing the bill (OCR).

## Users & core idea

- One **household** shared by two accounts (you + girlfriend).
- Every item flows through three states: **To Buy → In Stock → Used/Expired**.
- Items belong to one category: Dry groceries · Vegetables · Packaged food ·
  Fruits · Meat.
- The app warns you before food expires or goes stale, sends a morning
  summary, and tracks how much you spend by reading your receipts.

## Data model

**household** — id, name, members[]

**item**
- name, category, quantity, unit
- status: `to_buy` | `in_stock` | `used`
- added_by, purchased_date, expiry_date (optional)
- freshness_days (per-category default, editable)
- price (optional, linked from a receipt line)
- notes

**receipt** (spend tracking)
- image_url, store, purchased_date, total
- status: `processing` | `needs_review` | `confirmed`
- line_items[]: { name, qty, price, matched_item_id? }

**Freshness rule — the "needs attention" alert:**
An in-stock item needs attention when *either*:
- `expiry_date` is within 2 days (or passed), **or**
- `purchased_date + freshness_days` is within 1 day (or passed).

Per-category `freshness_days` defaults (editable per item):
Vegetables 5 · Fruits 6 · Meat 3 · Packaged food 7 · Dry groceries 30.

## Screens (mobile-first)

1. **Home / Today** — 🔴 Needs attention, 🟡 Expiring soon, then in-stock
   summary by category. Plus this-week / this-month spend total.
2. **Shopping list** — "To Buy" grouped by category, big checkboxes; check-off
   moves item to In Stock.
3. **Inventory** — what you have, sorted soonest-to-expire; mark Used / Throw
   away / edit quantity.
4. **Add item** — fast form (name → category fills the rest). "Buy again" from
   recent items.
5. **Scan bill** — take/upload a photo → OCR extracts line items + total →
   review & confirm → spend logged, items optionally added to inventory.
6. **Spend** — totals by week/month and by category; receipt history.

## Notifications

- Morning push (~8am) per household: "N items need attention today."
- Delivered via Web Push so it works on installed phone app (no app store).

## OCR flow (bill → spend)

1. User photographs receipt in the app.
2. Image uploaded to storage.
3. Backend function sends the image to a vision model that returns structured
   JSON: store, date, total, and line items (name, qty, price).
4. User reviews the parsed lines (fix any misreads), taps Confirm.
5. Spend is recorded; user can tick which lines to also add to inventory.

## Tech stack

- **Frontend:** Installable PWA (add-to-home-screen, works on both phones; no
  app store). React + Vite, or progressive enhancement of the static page.
- **Backend:** Supabase — Postgres (data), Auth (the two accounts), Realtime
  (instant sync when one of you checks something off), Storage (bill images),
  Edge Functions (OCR + scheduled morning push).
- **OCR:** Google **Gemini** (free tier) — a vision Flash model parses messy
  grocery receipts into structured line items more robustly than rigid OCR.
  Free quota easily covers two people scanning a few bills a week.
- **Push:** Web Push API + a scheduled Edge Function for the morning summary.

## Build phases

- **Phase 1 — local-first shell (no accounts needed):** PWA scaffold, data
  model, Home/Shopping/Inventory/Add screens, freshness+expiry alerts, all
  backed by on-device storage. Fully usable on one phone immediately.
- **Phase 2 — sharing:** Wire Supabase auth + Postgres + realtime so both
  phones see the same list live.
- **Phase 3 — bill OCR & spend:** Scan screen, storage upload, OCR function,
  review/confirm, spend dashboard.
- **Phase 4 — notifications:** Web Push subscription + scheduled morning summary.

## What I need from you to go past Phase 1

- A **Supabase** account/project (free tier) — for sharing, storage, OCR, push.
- A **Gemini API key** (free) for the OCR — from Google AI Studio.
- Apple/Android note: installed-PWA push works on Android and iOS 16.4+.
