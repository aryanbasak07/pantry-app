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
  let spendCats = [];         // custom spend category names
  let budgets = [];           // [{category, monthly}]
  let settlements = [];       // [{id, from, to, amount, date}]
  let recipes = [];           // [{id, name, servings, ingredients, steps, source, tags, createdBy}]
  let mealPlan = [];          // [{id, date, recipeId, title}]
  let needsPairing = false;
  const listeners = [];

  // sync/connection state (Phase 5)
  let online = (typeof navigator !== "undefined" && "onLine" in navigator) ? navigator.onLine : true;
  let syncing = false;
  let channelJoined = false;
  let reconnectTimer = null, reconnectBackoff = 1000;
  let flushTimer = null, flushBackoff = 2000;

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

  // ---------- Sync status ----------
  function pendingCount() { return household ? lsGet(outboxKey(household.id), []).length : 0; }
  function setSyncing(b) { if (syncing !== b) { syncing = b; emit(); } }
  function syncStatus() {
    if (mode !== "cloud") return { state: "local", pending: 0 };
    if (!online) return { state: "offline", pending: pendingCount() };
    if (syncing || pendingCount() > 0 || !channelJoined) return { state: "syncing", pending: pendingCount() };
    return { state: "synced", pending: 0 };
  }

  // ---------- Realtime (resilient: status-aware + auto-reconnect) ----------
  let channel = null, receiptChannel = null, subToken = 0;
  function teardownChannels() {
    subToken++; // invalidate any in-flight status callbacks from old channels
    try { if (channel) sb.removeChannel(channel); if (receiptChannel) sb.removeChannel(receiptChannel); } catch (_) {}
    channel = null; receiptChannel = null; channelJoined = false;
  }
  function handleItemChange(payload) {
    if (payload.eventType === "DELETE") items = items.filter((i) => i.id !== payload.old.id);
    else { const row = fromRow(payload.new); const idx = items.findIndex((i) => i.id === row.id); if (idx >= 0) items[idx] = row; else items.push(row); }
    lsSet(cacheKey(household.id), items); emit();
  }
  function handleReceiptChange(payload) {
    if (payload.eventType === "DELETE") receipts = receipts.filter((r) => r.id !== payload.old.id);
    else { const row = fromReceiptRow(payload.new); const idx = receipts.findIndex((r) => r.id === row.id); if (idx >= 0) receipts[idx] = row; else receipts.unshift(row); }
    lsSet("pantry.receipts.cloud." + household.id, receipts); emit();
  }
  function subscribe() {
    teardownChannels();
    const myToken = ++subToken;
    channel = sb.channel("items-" + household.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "items", filter: "household_id=eq." + household.id }, handleItemChange)
      .subscribe((status) => {
        if (myToken !== subToken) return; // stale callback from a torn-down channel
        if (status === "SUBSCRIBED") { if (!channelJoined) { channelJoined = true; resync(); emit(); } }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") { if (channelJoined) { channelJoined = false; emit(); } scheduleReconnect(); }
      });
    receiptChannel = sb.channel("receipts-" + household.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "receipts", filter: "household_id=eq." + household.id }, handleReceiptChange)
      .subscribe();
  }
  function scheduleReconnect() {
    if (reconnectTimer || mode !== "cloud" || !household) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; if (mode === "cloud" && household) subscribe(); }, reconnectBackoff);
    reconnectBackoff = Math.min(reconnectBackoff * 2, 30000);
  }
  async function resync() {
    if (mode !== "cloud" || !household) return;
    setSyncing(true);
    try { await pullItems(); await pullReceipts(); await pullSpendMeta(); } finally { setSyncing(false); }
  }
  function onResume() {
    online = (typeof navigator !== "undefined" && "onLine" in navigator) ? navigator.onLine : true;
    reconnectBackoff = 1000; // user is back — retry connection promptly
    if (mode === "cloud" && household) { if (!channelJoined) subscribe(); else resync(); flushOutbox(); }
    emit();
  }
  if (typeof window !== "undefined") {
    window.addEventListener("online", () => { online = true; onResume(); });
    window.addEventListener("offline", () => { online = false; emit(); });
    window.addEventListener("focus", onResume);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => { if (!document.hidden) onResume(); });
  }

  // ---------- Outbox (offline writes, retry with backoff) ----------
  function queue(op) { const q = lsGet(outboxKey(household.id), []); q.push(op); lsSet(outboxKey(household.id), q); emit(); }
  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(async () => { flushTimer = null; await flushOutbox(); }, flushBackoff);
    flushBackoff = Math.min(flushBackoff * 2, 60000);
  }
  async function flushOutbox() {
    if (mode !== "cloud" || !household) return;
    let q = lsGet(outboxKey(household.id), []);
    if (!q.length) { flushBackoff = 2000; return; }
    setSyncing(true);
    const remain = [];
    for (const op of q) {
      try {
        if (op.t === "upsert") { const { error } = await sb.from("items").upsert(op.row); if (error) throw error; }
        else if (op.t === "delete") { const { error } = await sb.from("items").delete().eq("id", op.id); if (error) throw error; }
        else if (op.t === "receipt") { const { error } = await sb.from("receipts").insert(op.row); if (error) throw error; }
        else if (op.t === "receipt_update") { const { error } = await sb.from("receipts").update(op.row).eq("id", op.id); if (error) throw error; }
        else if (op.t === "receipt_delete") { const { error } = await sb.from("receipts").delete().eq("id", op.id); if (error) throw error; }
      } catch (_) { remain.push(op); }
    }
    lsSet(outboxKey(household.id), remain);
    setSyncing(false);
    if (remain.length) scheduleFlush(); else flushBackoff = 2000;
  }

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
  async function rotateInviteCode() {
    if (mode !== "cloud" || !household) return null;
    const { data, error } = await sb.rpc("rotate_invite_code", { p_household: household.id });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (row && row.invite_code) household.invite_code = row.invite_code;
    emit();
    return household.invite_code;
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
      scheduleFlush();
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
  const fromReceiptRow = (r) => ({ id: r.id, store: r.store, date: r.purchased_date, currency: r.currency, total: r.total, items: r.line_items || [], paidBy: r.paid_by, split: r.split || "shared", createdBy: r.created_by, createdAt: r.created_at ? Date.parse(r.created_at) : Date.now() });
  const toReceiptRow = (r) => ({ id: r.id, household_id: household && household.id, store: r.store || null, purchased_date: r.date || null, currency: r.currency || null, total: r.total != null ? r.total : null, line_items: r.items || [], paid_by: r.paidBy || null, split: r.split || "shared", created_by: r.createdBy || null });

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
    if (mode === "cloud" && household) { try { const { error } = await sb.from("receipts").insert(toReceiptRow(r)); if (error) throw error; } catch (_) { queue({ t: "receipt", row: toReceiptRow(r) }); scheduleFlush(); } }
    else { lsSet(RC_LOCAL, receipts); }
    return r.id;
  }
  async function updateReceipt(r) {
    const idx = receipts.findIndex((x) => x.id === r.id); if (idx >= 0) receipts[idx] = r; emit();
    if (mode === "cloud" && household) { try { const { error } = await sb.from("receipts").update(toReceiptRow(r)).eq("id", r.id); if (error) throw error; } catch (_) { queue({ t: "receipt_update", id: r.id, row: toReceiptRow(r) }); scheduleFlush(); } }
    else { lsSet(RC_LOCAL, receipts); }
  }
  async function removeReceipt(id) {
    receipts = receipts.filter((r) => r.id !== id); emit();
    if (mode === "cloud" && household) { try { const { error } = await sb.from("receipts").delete().eq("id", id); if (error) throw error; } catch (_) { queue({ t: "receipt_delete", id }); scheduleFlush(); } }
    else { lsSet(RC_LOCAL, receipts); }
  }

  // ---------- Spend meta: custom categories, budgets, settlements ----------
  const SC_LOCAL = "pantry.spendcats.local", BD_LOCAL = "pantry.budgets.local", ST_LOCAL = "pantry.settlements.local";
  const dateStr = () => new Date().toISOString().slice(0, 10);
  async function pullSpendMeta() {
    if (mode === "cloud" && household) {
      const [c, b, s] = await Promise.all([
        sb.from("spend_categories").select("name").eq("household_id", household.id),
        sb.from("budgets").select("category,monthly").eq("household_id", household.id),
        sb.from("settlements").select("*").eq("household_id", household.id),
      ]);
      spendCats = (c.data || []).map((x) => x.name);
      budgets = (b.data || []).map((x) => ({ category: x.category, monthly: Number(x.monthly) }));
      settlements = (s.data || []).map((x) => ({ id: x.id, from: x.from_member, to: x.to_member, amount: Number(x.amount), date: x.date }));
    } else {
      spendCats = lsGet(SC_LOCAL, []); budgets = lsGet(BD_LOCAL, []); settlements = lsGet(ST_LOCAL, []);
    }
    emit();
  }
  async function pullSpend() { await pullReceipts(); await pullSpendMeta(); }
  async function addSpendCategory(name) {
    name = (name || "").trim(); if (!name || spendCats.includes(name)) return;
    spendCats.push(name); emit();
    if (mode === "cloud" && household) { try { await sb.from("spend_categories").insert({ household_id: household.id, name }); } catch (_) {} }
    else lsSet(SC_LOCAL, spendCats);
  }
  async function setBudget(category, monthly) {
    monthly = Number(monthly) || 0;
    const i = budgets.findIndex((b) => b.category === category);
    if (monthly <= 0) budgets = budgets.filter((b) => b.category !== category);
    else if (i >= 0) budgets[i].monthly = monthly; else budgets.push({ category, monthly });
    emit();
    if (mode === "cloud" && household) {
      try { if (monthly <= 0) await sb.from("budgets").delete().eq("household_id", household.id).eq("category", category); else await sb.from("budgets").upsert({ household_id: household.id, category, monthly }); } catch (_) {}
    } else lsSet(BD_LOCAL, budgets);
  }
  async function addSettlement(from, to, amount) {
    amount = Number(amount) || 0; if (amount <= 0) return;
    const s = { id: uuid(), from, to, amount, date: dateStr() };
    settlements.push(s); emit();
    if (mode === "cloud" && household) { try { await sb.from("settlements").insert({ household_id: household.id, from_member: from, to_member: to, amount, date: s.date }); } catch (_) {} }
    else lsSet(ST_LOCAL, settlements);
  }

  // ---------- Recipes + meal plan (Phase 8) ----------
  const RP_LOCAL = "pantry.recipes.local", MP_LOCAL = "pantry.mealplan.local";
  const fromRecipeRow = (r) => ({ id: r.id, name: r.name, servings: r.servings, ingredients: r.ingredients || [], steps: r.steps || [], source: r.source || "manual", tags: r.tags || [], createdBy: r.created_by });
  const toRecipeRow = (r) => ({ id: r.id, household_id: household && household.id, name: r.name, servings: r.servings || null, ingredients: r.ingredients || [], steps: r.steps || [], source: r.source || "manual", tags: r.tags || [], created_by: r.createdBy || null });
  const fromMealRow = (r) => ({ id: r.id, date: r.date, recipeId: r.recipe_id, title: r.title });
  const toMealRow = (r) => ({ id: r.id, household_id: household && household.id, date: r.date, recipe_id: r.recipeId || null, title: r.title });

  async function pullMeals() {
    if (mode === "cloud" && household) {
      const [rp, mp] = await Promise.all([
        sb.from("recipes").select("*").eq("household_id", household.id).order("created_at", { ascending: false }),
        sb.from("meal_plan").select("*").eq("household_id", household.id).order("date", { ascending: true }),
      ]);
      recipes = (rp.data || []).map(fromRecipeRow);
      mealPlan = (mp.data || []).map(fromMealRow);
    } else {
      recipes = lsGet(RP_LOCAL, []); mealPlan = lsGet(MP_LOCAL, []);
    }
    emit();
  }
  async function addRecipe(r) {
    r.id = (mode === "cloud") ? uuid() : ("rp" + Math.random().toString(36).slice(2, 9));
    r.createdBy = r.createdBy || myName();
    recipes.unshift(r); emit();
    if (mode === "cloud" && household) { try { const { error } = await sb.from("recipes").insert(toRecipeRow(r)); if (error) throw error; } catch (_) {} }
    else lsSet(RP_LOCAL, recipes);
    return r.id;
  }
  async function updateRecipe(r) {
    const i = recipes.findIndex((x) => x.id === r.id); if (i >= 0) recipes[i] = r; emit();
    if (mode === "cloud" && household) { try { await sb.from("recipes").update(toRecipeRow(r)).eq("id", r.id); } catch (_) {} }
    else lsSet(RP_LOCAL, recipes);
  }
  async function removeRecipe(id) {
    recipes = recipes.filter((x) => x.id !== id); emit();
    if (mode === "cloud" && household) { try { await sb.from("recipes").delete().eq("id", id); } catch (_) {} }
    else lsSet(RP_LOCAL, recipes);
  }
  async function addMeal(date, recipeId, title) {
    const meal = { id: (mode === "cloud") ? uuid() : ("mp" + Math.random().toString(36).slice(2, 9)), date, recipeId: recipeId || null, title };
    mealPlan.push(meal); emit();
    if (mode === "cloud" && household) { try { await sb.from("meal_plan").insert(toMealRow(meal)); } catch (_) {} }
    else lsSet(MP_LOCAL, mealPlan);
    return meal.id;
  }
  async function removeMeal(id) {
    mealPlan = mealPlan.filter((x) => x.id !== id); emit();
    if (mode === "cloud" && household) { try { await sb.from("meal_plan").delete().eq("id", id); } catch (_) {} }
    else lsSet(MP_LOCAL, mealPlan);
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
    try { localStorage.removeItem(LS_LOCAL); localStorage.removeItem(RC_LOCAL); localStorage.removeItem(SC_LOCAL); localStorage.removeItem(BD_LOCAL); localStorage.removeItem(ST_LOCAL); localStorage.removeItem(RP_LOCAL); localStorage.removeItem(MP_LOCAL); if (household) { localStorage.removeItem(cacheKey(household.id)); localStorage.removeItem(outboxKey(household.id)); localStorage.removeItem(importedKey(household.id)); localStorage.removeItem("pantry.receipts.cloud." + household.id); } } catch (_) {}
    items = []; receipts = []; spendCats = []; budgets = []; settlements = []; recipes = []; mealPlan = []; household = null; members = [];
  }

  return {
    init, onChange: (f) => listeners.push(f),
    mode: () => mode, needsPairing: () => needsPairing,
    syncStatus, resync,
    inviteCode: () => household && household.invite_code,
    rotateInviteCode,
    householdName: () => household && household.name,
    items: () => items, catFresh: CAT_FRESH,
    receipts: () => receipts, pullReceipts, pullSpend, addReceipt, updateReceipt, removeReceipt,
    spendCategories: () => spendCats, addSpendCategory,
    budgets: () => budgets, setBudget,
    settlements: () => settlements, addSettlement,
    recipes: () => recipes, addRecipe, updateRecipe, removeRecipe,
    mealPlan: () => mealPlan, addMeal, removeMeal, pullMeals,
    pushSupported, saveSubscription, removeSubscription,
    add, update, remove,
    createHousehold, joinHousehold,
    memberNames, myName, setMyName, setLocalNames,
    importPending, importLocalItems, skipImport, hasLocalItems,
    loadSample, reset,
  };
})();
