# Pantry → Kitchen OS — Robustness & Expansion Roadmap

Goal: make the app reliable enough to trust daily, then grow it into the single
place you manage your **kitchen, inventory, and expenses**. Phases are ordered so
the foundation is solid *before* we pile features on top. Each phase is independent
enough to ship and review on its own.

Status today: Phases 1–4 are live (shopping list, shared inventory with freshness
alerts, Gemini bill OCR + spend, morning push). This roadmap is "v2".

---

## Robustness findings from the current code (what to harden)

These are real gaps I found reviewing `src/sync.js`, the SQL, and the app flows:

1. **Realtime never recovers from drops.** `subscribe()` (sync.js) opens one channel
   and never watches its status. When the phone sleeps or wifi blips, the socket
   closes and changes are silently missed — no re-subscribe, no re-pull on focus.
   → The two phones can quietly drift out of sync.
2. **Receipts don't live-sync.** Spend only loads when you open the Spend tab; a scan
   on one phone isn't pushed to the other.
3. **No sync status.** Optimistic writes that fail are queued to a localStorage
   "outbox" and only retried on the next successful write or the browser `online`
   event — a transient failure can sit for a long time, and the user sees nothing
   (no "offline / syncing / 2 pending" indicator).
4. **No conflict handling.** Writes are full-row `upsert` = last-write-wins; two
   concurrent edits can clobber each other's fields.
5. **Weak pairing security.** Invite code is 6 hex chars and `join_household` is
   callable by any anonymous user with no rate limit and codes never expire →
   brute-forceable. Needs longer codes + expiry/rotation + rate limiting.
6. **No input validation or DB constraints.** `status`, `category`, `qty`, `price`
   have no CHECK constraints; negative/garbage values are possible.
7. **Errors are swallowed.** `pullItems`/`refreshMembers` just `return` on error, so
   failures are invisible. No logging/telemetry.
8. **No automated tests** anywhere — freshness logic, row mapping, OCR normalization,
   and sync are all untested.
9. **No account recovery.** The anonymous session lives only in the browser; clearing
   Safari data loses the membership link with no way back in (no recovery code/export).
10. **Misc:** no double-tap guards on pairing/scan (can create duplicate households),
    silent localStorage-quota failures, fixed 2-member model, timezone mismatch
    (cron fixed to 08:00 IST while freshness uses device-local time), limited a11y,
    and no "new version available" prompt.

---

## Phase 5 — Reliability & trust (foundation) ⭐ do first

Make today's features bulletproof. Highest priority — everything else sits on this.

- Realtime: watch channel status; **re-subscribe + re-pull on reconnect and on app
  focus/visibility change**. Add a periodic safety re-pull.
- **Live-sync receipts** (subscribe to the `receipts` table too).
- **Sync-status UI**: a small indicator (synced / offline / syncing / N pending) and
  visible, friendly error toasts instead of silent failures.
- **Retry with backoff** for failed writes (not only on `online`).
- **Validation + DB CHECK constraints** (status, category, qty ≥ 0, price ≥ 0,
  non-empty name) on both client and Postgres.
- **Harden pairing**: longer random codes, expiry/rotation, basic rate-limiting on
  `join_household`; quick RLS audit. Rotate the exposed `CRON_SECRET`.
- **Undo + confirm** for destructive actions (delete item, leave kitchen, clear data).
- **Automated tests + CI** (freshness buckets, row mapping, OCR normalize, spend math)
  and lightweight error logging.

Effort: M–L. Deps: none new. This is the "sleep well at night" phase.

---

## Phase 6 — Inventory you can trust day-to-day

Turn the list into a real pantry you actually maintain.

- **Storage locations** (Fridge / Freezer / Pantry / Spice rack) with per-location views.
- **Quantity & partial use** ("used half"), proper units, low-stock threshold per item.
- **Barcode scanning** to add fast — auto-fill name, category, and often expiry
  (camera + a barcode library + a product-lookup API).
- **Staples & auto-restock**: mark recurring items; when stock runs low or an item is
  used up, auto-suggest it back onto the shopping list.
- **Custom categories/tags** (beyond the fixed 5) and optional item photos.
- **Waste insights** (you already store a `wasted` flag): "most-wasted items / ₹ wasted."

Effort: M–L. Deps: a barcode lib + product-lookup API (free tiers exist).

---

## Phase 7 — Expenses as a real budgeting tool

Make spend tracking something you'd actually budget with.

- **Store receipt images** (Supabase Storage) → re-parse, audit, and **edit/delete
  receipts** after saving (today they're write-once).
- **Budgets**: monthly total + per-category budgets, progress bars, and alerts when
  you're near/over.
- **Trends & price history**: month-over-month, "you spend most on meat," and per-item
  price changes ("milk went up 12%"); store comparison.
- **Couple accounting (optional)**: who paid, split, simple settle-up.
- **Export**: CSV / shareable monthly summary. Fix multi-currency handling (don't sum
  mixed currencies blindly).

Effort: M. Deps: Supabase Storage (free tier), small Gemini usage for re-parse.

---

## Phase 8 — Meal planning & zero-waste (the "manage my kitchen" glue)

The layer that ties inventory + spend together and cuts waste.

- **Recipe library** + a simple **weekly meal planner**.
- **Generate the shopping list from planned meals** minus what's already in stock.
- **"Cook this before it expires"**: Gemini suggests recipes from your
  needs-attention items — directly attacks food waste.
- Optional **nutrition** info per meal.

Effort: L. Deps: Gemini (already wired). High "wow", best done after 5–7 are solid.

---

## Phase 9 — Intelligence & fast input

Reduce the effort of keeping it up to date (the main reason kitchen apps get abandoned).

- **Natural-language / voice quick-add** via Gemini: "add 2 litres milk, spinach, and
  chicken" → parsed into items.
- **Smarter, personalized notifications**: expiry-today, low-stock, budget warnings,
  and a weekly digest — with **per-user preferences, quiet hours, and correct
  timezone** (fixes the fixed-IST issue).
- **Predictive run-out** from usage history → proactive restock.

Effort: M–L. Deps: Gemini; Web Speech API for voice.

---

## Phase 10 — Polish & scale

- **Accessibility**: focus-trapped modals, `aria-live` for toasts, real labels.
- **"Update available — refresh" prompt** when a new version deploys.
- **Backup & account recovery**: export/import, and a recovery code so clearing the
  browser doesn't lock you out.
- Performance (virtualized long lists), refined icons/splash, PWA niceties.

Effort: M. Deps: none new.

---

## Suggested order & rationale

5 → (6 ‖ 7) → 8 → 9 → 10.

- **Phase 5 first, always** — reliability is the foundation; without it, more features
  just mean more things that can silently break.
- **6 and 7 are independent** — pick whichever pain (inventory vs. money) you feel more.
- **8 (meal planning)** is the feature that makes it genuinely "manage my whole
  kitchen," but it leans on solid inventory + spend, so it comes after.
- **9 and 10** make it pleasant and sticky once the substance is there.

Open questions for review:
- Which matters more right now — inventory depth (Phase 6) or budgeting (Phase 7)?
- Is couple-accounting (who-paid/settle-up) wanted, or is shared total enough?
- Appetite for barcode scanning and a product-lookup dependency?
- Any features here you'd drop, or anything missing from your daily kitchen routine?
