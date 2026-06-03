// Vercel Cron target: each morning, count "needs attention" items per household
// and push a summary to that household's devices. Reads data with the Supabase
// service-role key (server-side only) and signs pushes with the VAPID private key.
const webpush = require("web-push");

const DAY = 86400000;
function parseDate(s) { return Date.parse(s + "T00:00:00Z"); }
function startOfTodayUTC() { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
function needsAttention(it, today) {
  const c = [];
  if (it.expiry_date) c.push(Math.round((parseDate(it.expiry_date) - today) / DAY));
  if (it.purchased_date) c.push(Math.round((parseDate(it.purchased_date) + (it.freshness_days || 7) * DAY - today) / DAY));
  if (!c.length) return false;
  return Math.min.apply(null, c) <= 2;
}

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const got = (req.headers.authorization || "").replace("Bearer ", "");
    if (got !== secret) return res.status(401).json({ error: "unauthorized" });
  }
  const SB = process.env.SUPABASE_URL;
  const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const VPUB = process.env.VAPID_PUBLIC_KEY;
  const VPRIV = process.env.VAPID_PRIVATE_KEY;
  const VSUB = process.env.VAPID_SUBJECT || "mailto:pantry@example.com";
  if (!SB || !SRK || !VPUB || !VPRIV) return res.status(500).json({ error: "Missing env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)" });

  webpush.setVapidDetails(VSUB, VPUB, VPRIV);
  const get = (path) => fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } }).then((r) => r.json());

  try {
    const items = await get("items?status=eq.in_stock&select=household_id,expiry_date,purchased_date,freshness_days");
    const subs = await get("push_subscriptions?select=id,household_id,subscription");
    const today = startOfTodayUTC();

    const countByHH = {};
    items.forEach((it) => { if (needsAttention(it, today)) countByHH[it.household_id] = (countByHH[it.household_id] || 0) + 1; });

    let sent = 0, removed = 0;
    for (const s of subs) {
      const n = countByHH[s.household_id] || 0;
      if (n <= 0) continue;
      const payload = JSON.stringify({ title: "Pantry", body: `${n} item${n > 1 ? "s" : ""} need attention today`, url: "/" });
      try { await webpush.sendNotification(s.subscription, payload); sent++; }
      catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) {
          await fetch(`${SB}/rest/v1/push_subscriptions?id=eq.${s.id}`, { method: "DELETE", headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } });
          removed++;
        }
      }
    }
    return res.status(200).json({ households: Object.keys(countByHH).length, subscriptions: subs.length, sent, removed });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
