/* Pure, side-effect-free kitchen logic — shared by the UI (window.PantryLogic)
 * and the test suite (require). No DOM, no network. Keep it deterministic. */
(function (root, factory) {
  const lib = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = lib;
  if (typeof window !== "undefined") window.PantryLogic = lib;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const DAY = 86400000;
  const CATS = ["vegetables", "fruits", "meat", "packaged", "dry"];
  const STATUSES = ["to_buy", "in_stock", "used"];

  function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function parseISO(s) { return new Date(s + "T00:00:00"); }
  function toISO(d) { const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function diffDays(from, to) { return Math.round((to - from) / DAY); }
  function todayISO() { return toISO(startOfToday()); }

  function reasonText(kind, d) {
    if (kind === "expiry") return d < 0 ? "Expired" : d === 0 ? "Expires today" : d === 1 ? "Expires tomorrow" : `Expires in ${d}d`;
    return d < 0 ? "Overdue — use now" : d === 0 ? "Use today" : d === 1 ? "Use by tomorrow" : `Use within ${d}d`;
  }
  function pillClass(b) { return b === "attention" ? "pill--red" : b === "soon" ? "pill--amber" : "pill--green"; }

  // Returns {daysLeft, bucket: attention|soon|fresh|none, reason}. `now` optional (Date) for tests.
  function freshness(item, now) {
    const t = now || startOfToday();
    const c = [];
    if (item.expiryDate) c.push({ d: diffDays(t, parseISO(item.expiryDate)), kind: "expiry" });
    if (item.purchasedDate) c.push({ d: diffDays(t, addDays(parseISO(item.purchasedDate), item.freshnessDays || 7)), kind: "fresh" });
    if (!c.length) return { daysLeft: null, bucket: "none", reason: "" };
    c.sort((a, b) => a.d - b.d);
    const { d, kind } = c[0];
    const bucket = d <= 2 ? "attention" : d <= 5 ? "soon" : "fresh";
    return { daysLeft: d, bucket, reason: reasonText(kind, d) };
  }
  const needsAttention = (item, now) => freshness(item, now).bucket === "attention";

  // ----- spend -----
  function spendSince(receipts, days, now) {
    const cut = addDays(now ? new Date(now) : startOfToday(), -days + 1);
    return receipts.filter((r) => r.date && parseISO(r.date) >= cut).reduce((s, r) => s + (Number(r.total) || 0), 0);
  }
  function spendByCategory(receipts, days, now) {
    const cut = addDays(now ? new Date(now) : startOfToday(), -days + 1);
    const map = {};
    receipts.filter((r) => r.date && parseISO(r.date) >= cut).forEach((r) =>
      (r.items || []).forEach((it) => { const c = it.category || "other"; map[c] = (map[c] || 0) + (Number(it.price) || 0); }));
    return map;
  }

  // ----- validation -----
  function validateItem(it) {
    const errors = [];
    const name = (it.name || "").trim();
    if (!name) errors.push("Please enter a name");
    if (!CATS.includes(it.category)) errors.push("Pick a category");
    if (it.status && !STATUSES.includes(it.status)) errors.push("Invalid status");
    let qty = (it.qty === null || it.qty === undefined || it.qty === "") ? null : Number(it.qty);
    if (qty != null && (isNaN(qty) || qty < 0)) { errors.push("Quantity can't be negative"); qty = null; }
    let fresh = Number(it.freshnessDays);
    if (isNaN(fresh) || fresh < 1) fresh = 7;
    const cleaned = Object.assign({}, it, { name, qty, freshnessDays: fresh });
    return { ok: errors.length === 0, errors, cleaned };
  }

  return {
    DAY, CATS, STATUSES,
    startOfToday, parseISO, toISO, addDays, diffDays, todayISO,
    reasonText, pillClass, freshness, needsAttention,
    spendSince, spendByCategory, validateItem,
  };
});
