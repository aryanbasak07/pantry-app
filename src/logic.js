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

  // ----- month + budgets + couple accounting (Phase 7) -----
  function currentYM(now) { const d = now ? new Date(now) : new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
  function monthSpend(receipts, ym) {
    const inM = receipts.filter((r) => r.date && r.date.slice(0, 7) === ym);
    const total = inM.reduce((s, r) => s + (Number(r.total) || 0), 0);
    const byCat = {};
    inM.forEach((r) => (r.items || []).forEach((it) => { const c = it.category || "other"; byCat[c] = (byCat[c] || 0) + (Number(it.price) || 0); }));
    return { total, byCat };
  }
  function budgetProgress(receipts, budgets, ym) {
    const m = monthSpend(receipts, ym);
    return (budgets || []).map((b) => {
      const spent = b.category === "TOTAL" ? m.total : (m.byCat[b.category] || 0);
      return { category: b.category, budget: Number(b.monthly) || 0, spent, pct: b.monthly > 0 ? Math.round((spent / b.monthly) * 100) : 0 };
    });
  }
  // Only 'shared' receipts split between members; 'personal' is ignored.
  function computeBalances(receipts, members, settlements) {
    const net = {}; members.forEach((m) => (net[m] = 0));
    const n = members.length || 1;
    receipts.forEach((r) => {
      if (r.split === "personal") return;
      const total = Number(r.total) || 0;
      if (r.paidBy && net[r.paidBy] !== undefined) net[r.paidBy] += total;
      members.forEach((m) => { net[m] -= total / n; });
    });
    (settlements || []).forEach((s) => {
      if (net[s.from] !== undefined) net[s.from] += Number(s.amount) || 0;
      if (net[s.to] !== undefined) net[s.to] -= Number(s.amount) || 0;
    });
    let owe = null;
    if (members.length === 2) {
      const [a, b] = members; const na = net[a];
      if (Math.abs(na) >= 0.01) owe = na > 0 ? { from: b, to: a, amount: Math.round(na * 100) / 100 } : { from: a, to: b, amount: Math.round(-na * 100) / 100 };
    }
    return { net, owe };
  }

  return {
    DAY, CATS, STATUSES,
    startOfToday, parseISO, toISO, addDays, diffDays, todayISO,
    reasonText, pillClass, freshness, needsAttention,
    spendSince, spendByCategory, validateItem,
    currentYM, monthSpend, budgetProgress, computeBalances,
  };
});
