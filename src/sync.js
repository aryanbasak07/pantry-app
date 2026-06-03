/* Data layer for Pantry & Spend.
 * Two modes, same API:
 *   - "local": everything in localStorage (Phase 1 behaviour, offline, single device).
 *   - "cloud": shared via Supabase — silent anonymous session + a household the two
 *              phones pair into, with realtime sync. Falls back to "local" if Supabase
 *              is unreachable or anonymous sign-ins are off, so the app never breaks.
 * The UI (app.js) only ever talks to window.Data and re-renders on Data.onChange().
 */
window.Data = (() => {
  "use strict";

  const CAT_FRESH = { vegetables: 5, fruits: 6, meat: 3, packaged: 7, dry: 30 };
  const LS_LOCAL = "pantry.v1";              // local-mode store {items, members, me, seeded}
  const cacheKey = (h) => `pantry.cache.${h}`;
  const outboxKey = (h) => `pantry.outbox.${h}`;
  const importedKey = (h) => `pantry.imported.${h}`;

  let mode = "local";
  let sb = null;
  let uid = null;
  let household = null;        // {id, name, invite_code}
  let members = [];           // [{user_id, name}]
  let items = [];             // app-shaped items (the render source of truth)
  let receipts = [];          // app-shaped receipts (spend tracking)
  let needsPairing = false;
  const listeners = [];

  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
  const emit = () => listeners.forEach((f) => { try { f(); } catch (_) {} });
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    }));

  // ---------- DB row <-> app item ----------
  const fromRow = (r) => ({
    id: r.id, name: r.name, category: r.category, qty: r.qty, unit: r.unit,
    status: r.status, addedBy: r.added_by, purchasedDate: r.purchased_date,
    expiryDate: r.expiry_date, freshnessDays: r.freshness_days, notes: r.notes || "",
    wasted: r.wasted, usedDate: r.used_date,
    createdAt: r.created_at ? Date.parse(r.created_at) : Date.now(),
  });
  const toRow = (i) => ({
    id: i.id, household_id: household && household.id, name: i.name, category: i.category,
    qty: i.qty, unit: i.unit, status: i.status, added_by: i.addedBy,
    purchased_date: i.purchasedDate || null, expiry_date: i.expiryDate || null,
    freshness_days: i.freshnessDays, notes: i.notes || "", wasted: !!i.wasted,
    used_date: i.usedDate || null,
  });

  // ---------- LOCAL mode ----------
  function localState() { return lsGet(LS_LOCAL, { items: [], members: ["Me", "Partner"], me: 0, seeded: false }); }
  function saveLocal(st) { lsSet(LS_LOCAL, st); }

  // ---------- INIT ----------
  async function init() {
    const cfg = window.PANTRY_CONFIG;
    if (!(window.supabase && cfg && cfg.url && cfg.anonKey)) return startLocal();
    try {
      sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
      let { data: { session } } = await sb.auth.getSession();
      if (!session) {
        const res = await sb.auth.signInAnonymously();
        if (res.error) throw res.error;     // anonymous disabled -> fall back to local
        session = res.data.session;
      }
      uid = session.user.id;
      mode = "cloud";
      await loadHousehold();
      return { mode, needsPairing };
    } catch (e) {
      console.warn("[Data] cloud unavailable, using local mode:", e && e.message);
      return startLocal();
    }
  }
  function startLocal() {
    mode = "local"; needsPairing = false;
    items = localState().items;
    return { mode, needsPairing };
  }

  async function loadHousehold() {
    const { data, error } = await sb
      .from("household_members")
      .select("name, households(id,name,invite_code)")
      .eq("user_id", uid)
      .limit(1);
    if (error) throw error;
    if (!data || !data.length || !data[0].households) {
      household = null; needsPairing = true; items = [];
      return;
    }
    household = data[0].households;
    needsPairing = false;
    items = lsGet(cacheKey(household.id), []);   // instant render from cache
    await refreshMembers();
    await pullItems();
    subscribe();
    flushOutbox();
  }

  async function refreshMembers() {
    const { data } = await sb.from("household_members").select("user_id,name").eq("household_id", household.id);
    members = data || [];
  }
  async function pullItems() {
    const { data, error } = await sb.from("items").select("*").eq("household_id", household.id);
    if (error) return;
    items = data.map(fromRow);
    lsSet(cacheKey(household.id), items);
    emit();
  }

  // ---------- Realtime ----------
  let channel = null;
  function subscribe() {
    if (channel) sb.removeChannel(channel);
    channel = sb
      .channel("items-" + household.id)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "items", filter: "household_id=eq." + household.id },
        (payload) => {
          if (payload.eventType === "DELETE") {
            items = items.filter((i) => i.id !== payload.old.id);
          } else {
            const row = fromRow(payload.new);
            const idx = items.findIndex((i) => i.id === row.id);
            if (idx >= 0) items[idx] = row; else items.push(row);
          }
          lsSet(cacheKey(household.id), items);
          emit();
        })
      .subscribe();
  }

  // ---------- Outbox (offline writes) ----------
  function queue(op) {
    const q = lsGet(outboxKey(household.id), []);
    q.push(op); lsSet(outboxKey(household.id), q);
  }
  async function flushOutbox() {
    if (mode !== "cloud" || !household) return;
    let q = lsGet(outboxKey(household.id), []);
    if (!q.length) return;
    const remain = [];
    for (const op of q) {
      try {
        if (op.t === "upsert") { const { error } = await sb.from("items").upsert(op.row); if (error) throw error; }
        else if (op.t === "delete") { const { error } = await sb.from("items").delete().eq("id", op.id); if (error) throw error; }
        else if (op.t === "receipt") { const { error } = await sb.from("receipts").insert(op.row); if (error) throw error; }
      } catch (_) { remain.push(op); }
    }
    lsSet(outboxKey(household.id), remain);
  }
  if (typeof window !== "undefined") window.addEventListener("online", flushOutbox);

  // ---------- Pairing ----------
  async function createHousehold(name, myName) {
    const { data, error } = await sb.rpc("create_household", { p_name: name || "Our Kitchen", p_member_name: myName || "Me" });
    if (error) throw error;
    household = Array.isArray(data) ? data[0] : data;
    needsPairing = false;
    await refreshMembers(); await pullItems(); subscribe();
    return household;
  }
  async function joinHousehold(code, myName) {
    const { data, error } = await sb.rpc("join_household", { p_code: (code || "").trim().toUpperCase(), p_member_name: myName || "Me" });
    if (error) throw error;
    household = Array.isArray(data) ? data[0] : data;
    needsPairing = false;
    await refreshMembers(); await pullItems(); subscribe();
    return household;
  }

  // ---------- Mutations (mode-aware, optimistic) ----------
  function persistLocal() { const st = localState(); st.items = items; saveLocal(st); }

  function add(item) {
    item.id = (mode === "cloud") ? uuid() : ("i" + Math.random().toString(36).slice(2, 9));
    item.createdAt = Date.now();
    items.push(item); emit();
    if (mode === "cloud") write("upsert", item); else persistLocal();
    return item.id;
  }
  function update(item) {
    const idx = items.findIndex((i) => i.id === item.id);
    if (idx >= 0) items[idx] = item; else items.push(item);
    emit();
    if (mode === "cloud") write("upsert", item); else persistLocal();
  }
  function remove(id) {
    items = items.filter((i) => i.id !== id); emit();
    if (mode === "cloud") write("delete", null, id); else persistLocal();
  }
  async function write(t, item, id) {
    try {
      if (t === "upsert") { const { error } = await sb.from("items").upsert(toRow(item)); if (error) throw error; }
      else { const { error } = await sb.from("items").delete().eq("id", id); if (error) throw error; }
      flushOutbox();
    } catch (_) {
      queue(t === "upsert" ? { t: "upsert", row: toRow(item) } : { t: "delete", id });
    }
  }

  // ---------- Members / settings ----------
  function memberNames() {
    if (mode === "cloud") return members.map((m) => m.name);
    const st = localState(); return st.members;
  }
  function myName() {
    if (mode === "cloud") { const m = members.find((x) => x.user_id === uid); return m ? m.name : "Me"; }
    const st = localState(); return st.members[st.me] || "Me";
  }
  async function setMyName(name) {
    name = (name || "").trim() || "Me";
    if (mode === "cloud") {
      await sb.from("household_members").update({ name }).eq("household_id", household.id).eq("user_id", uid);
      await refreshMembers(); emit();
    }
  }
  function setLocalNames(me, partner) {
    const st = localState(); st.members = [me || "Me", partner || "Partner"]; st.me = 0; saveLocal(st);
  }

  // ---------- Import local items into the shared kitchen ----------
  function hasLocalItems() { return localState().items.length > 0; }
  function importPending() { return mode === "cloud" && household && hasLocalItems() && !lsGet(importedKey(household.id), false); }
  async function importLocalItems() {
    const local = localState().items;
    for (const it of local) {
      const copy = Object.assign({}, it, { id: uuid(), addedBy: it.addedBy || myName() });
      items.push(copy);
      try { await sb.from("items").upsert(toRow(copy)); } catch (_) { queue({ t: "upsert", row: toRow(copy) }); }
    }
    lsSet(importedKey(household.id), true);
    emit();
  }
  function skipImport() { if (household) lsSet(importedKey(household.id), true); }

  // ---------- Receipts / spend ----------
  const RC_LOCAL = "pantry.receipts.local";
  const fromReceiptRow = (r) => ({ id: r.id, store: r.store, date: r.purchased_date, currency: r.currency, total: r.total, items: r.line_items || [], createdBy: r.created_by, createdAt: r.created_at ? Date.parse(r.created_at) : Date.now() });
  const toReceiptRow = (r) => ({ id: r.id, household_id: household && household.id, store: r.store || null, purchased_date: r.date || null, currency: r.currency || null, total: r.total != null ? r.total : null, line_items: r.items || [], created_by: r.createdBy || null });

  async function pullReceipts() {
    if (mode === "cloud" && household) {
      const { data } = await sb.from("receipts").select("*").eq("household_id", household.id).order("purchased_date", { ascending: false });
      receipts = (data || []).map(fromReceiptRow);
      lsSet("pantry.receipts.cloud." + household.id, receipts);
    } else {
      receipts = lsGet(RC_LOCAL, []);
    }
    emit();
    return receipts;
  }
  async function addReceipt(r) {
    r.id = (mode === "cloud") ? uuid() : ("r" + Math.random().toString(36).slice(2, 9));
    r.createdBy = r.createdBy || myName();
    r.createdAt = Date.now();
    receipts.unshift(r); emit();
    if (mode === "cloud" && household) { try { const { error } = await sb.from("receipts").insert(toReceiptRow(r)); if (error) throw error; } catch (_) { queue({ t: "receipt", row: toReceiptRow(r) }); } }
    else { lsSet(RC_LOCAL, receipts); }
    return r.id;
  }

  // ---------- Push subscriptions (Phase 4) ----------
  function pushSupported() { return mode === "cloud" && !!household; }
  async function saveSubscription(subJson) {
    if (!pushSupported()) throw new Error("Sharing must be on to enable alerts");
    const { error } = await sb.from("push_subscriptions").upsert(
      { household_id: household.id, user_id: uid, endpoint: subJson.endpoint, subscription: subJson },
      { onConflict: "endpoint" });
    if (error) throw error;
  }
  async function removeSubscription(endpoint) {
    if (mode !== "cloud" || !endpoint) return;
    await sb.from("push_subscriptions").delete().eq("endpoint", endpoint);
  }

  // ---------- Sample / reset ----------
  function loadSample(sample) { sample.forEach((s) => add(s)); }
  async function reset() {
    if (mode === "cloud") { try { if (channel) sb.removeChannel(channel); await sb.auth.signOut(); } catch (_) {} }
    try { localStorage.removeItem(LS_LOCAL); localStorage.removeItem(RC_LOCAL); if (household) { localStorage.removeItem(cacheKey(household.id)); localStorage.removeItem(outboxKey(household.id)); localStorage.removeItem(importedKey(household.id)); localStorage.removeItem("pantry.receipts.cloud." + household.id); } } catch (_) {}
    items = []; receipts = []; household = null; members = [];
  }

  return {
    init, onChange: (f) => listeners.push(f),
    mode: () => mode, needsPairing: () => needsPairing,
    inviteCode: () => household && household.invite_code,
    householdName: () => household && household.name,
    items: () => items, catFresh: CAT_FRESH,
    receipts: () => receipts, pullReceipts, addReceipt,
    pushSupported, saveSubscription, removeSubscription,
    add, update, remove,
    createHousehold, joinHousehold,
    memberNames, myName, setMyName, setLocalNames,
    importPending, importLocalItems, skipImport, hasLocalItems,
    loadSample, reset,
  };
})();
