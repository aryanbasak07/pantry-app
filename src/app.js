/* Pantry & Spend — UI layer.
 * Reads/writes all data through window.Data (src/sync.js), which transparently
 * runs in local mode or shared "cloud" mode. This file is pure UI + freshness logic. */
(() => {
  "use strict";

  // ---------- Categories ----------
  const CATEGORIES = {
    vegetables: { label: "Vegetables", emoji: "🥦", freshness: 5, unit: "kg" },
    fruits:     { label: "Fruits",     emoji: "🍎", freshness: 6, unit: "kg" },
    meat:       { label: "Meat",       emoji: "🍗", freshness: 3, unit: "kg" },
    packaged:   { label: "Packaged food", emoji: "📦", freshness: 7, unit: "pack" },
    dry:        { label: "Dry groceries", emoji: "🌾", freshness: 30, unit: "kg" },
  };
  const CAT_ORDER = ["vegetables", "fruits", "meat", "packaged", "dry"];

  // ---------- Date helpers ----------
  const DAY = 86400000;
  function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function parseISO(s) { return new Date(s + "T00:00:00"); }
  function toISO(d) { const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function diffDays(from, to) { return Math.round((to - from) / DAY); }
  const todayISO = () => toISO(startOfToday());

  // ---------- Freshness logic ----------
  function freshness(item) {
    const t = startOfToday();
    const c = [];
    if (item.expiryDate) c.push({ d: diffDays(t, parseISO(item.expiryDate)), kind: "expiry" });
    if (item.purchasedDate) c.push({ d: diffDays(t, addDays(parseISO(item.purchasedDate), item.freshnessDays || 7)), kind: "fresh" });
    if (!c.length) return { daysLeft: null, bucket: "none", reason: "" };
    c.sort((a, b) => a.d - b.d);
    const { d, kind } = c[0];
    const bucket = d <= 2 ? "attention" : d <= 5 ? "soon" : "fresh";
    return { daysLeft: d, bucket, reason: reasonText(kind, d) };
  }
  function reasonText(kind, d) {
    if (kind === "expiry") return d < 0 ? "Expired" : d === 0 ? "Expires today" : d === 1 ? "Expires tomorrow" : `Expires in ${d}d`;
    return d < 0 ? "Overdue — use now" : d === 0 ? "Use today" : d === 1 ? "Use by tomorrow" : `Use within ${d}d`;
  }
  const pillClass = (b) => b === "attention" ? "pill--red" : b === "soon" ? "pill--amber" : "pill--green";

  // ---------- Selectors (data comes from Data) ----------
  const all = () => Data.items();
  const byStatus = (s) => all().filter((i) => i.status === s);
  const inStock = () => byStatus("in_stock");
  const toBuy = () => byStatus("to_buy");
  const attentionItems = () => inStock().filter((i) => freshness(i).bucket === "attention").sort((a, b) => freshness(a).daysLeft - freshness(b).daysLeft);
  const soonItems = () => inStock().filter((i) => freshness(i).bucket === "soon").sort((a, b) => freshness(a).daysLeft - freshness(b).daysLeft);
  const getItem = (id) => all().find((i) => i.id === id);

  // ---------- Mutations (via Data) ----------
  function moveToStock(id) { const it = getItem(id); if (!it) return; it.status = "in_stock"; if (!it.purchasedDate) it.purchasedDate = todayISO(); Data.update(it); }
  function markUsed(id, wasted) { const it = getItem(id); if (!it) return; it.status = "used"; it.wasted = !!wasted; it.usedDate = todayISO(); Data.update(it); }

  // ---------- Router ----------
  let screen = "home";
  const TITLES = { home: "Today", list: "Shopping list", stock: "In stock", spend: "Spend" };
  function setScreen(s) {
    if (s === "add") return openForm();
    screen = s;
    document.getElementById("screen-title").textContent = TITLES[s] || "Pantry";
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.screen === s));
    if (s === "spend" && Data.pullReceipts) Data.pullReceipts();
    render();
  }

  const app = () => document.getElementById("app");
  function render() {
    if (Data.needsPairing && Data.needsPairing()) return renderPairing();
    if (screen === "home") app().innerHTML = viewHome();
    else if (screen === "list") app().innerHTML = viewList();
    else if (screen === "stock") app().innerHTML = viewStock();
    else if (screen === "spend") app().innerHTML = viewSpend();
    updateBadges();
  }
  function updateBadges() {
    const setBadge = (id, n) => { const el = document.getElementById(id); if (!el) return; el.hidden = n <= 0; el.textContent = n; };
    setBadge("badge-list", toBuy().length);
    setBadge("badge-stock", attentionItems().length);
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  const qtyText = (i) => i.qty ? `${i.qty} ${esc(i.unit || "")}`.trim() : esc(i.unit || "");

  // ----- Home -----
  function viewHome() {
    const att = attentionItems(), soon = soonItems(), stock = inStock(), buy = toBuy();
    let h = `<div class="screen">`;
    if (Data.importPending && Data.importPending()) {
      h += `<div class="banner" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <span>Bring your existing items into the shared kitchen?</span>
        <span style="display:flex;gap:6px">
          <button class="btn btn--primary btn--sm" data-act="import">Import</button>
          <button class="btn btn--ghost btn--sm" data-act="skip-import">Not now</button>
        </span></div>`;
    }
    if (!all().length && !(Data.importPending && Data.importPending())) return h + emptyApp() + `</div>`;

    h += `<div class="tiles">
      <div class="tile ${att.length ? "tile--warn" : ""}" data-act="go" data-screen="stock">
        <div class="big">${att.length}</div><div class="lbl">Need attention</div></div>
      <div class="tile" data-act="go" data-screen="list">
        <div class="big">${buy.length}</div><div class="lbl">To buy</div></div>
    </div>`;
    if (att.length) { h += sectionTitle("🔴 Needs attention", att.length); h += `<div class="card">${att.map(itemRow).join("")}</div>`; }
    if (soon.length) { h += sectionTitle("🟡 Expiring soon", soon.length); h += `<div class="card">${soon.map(itemRow).join("")}</div>`; }
    h += sectionTitle("In stock by category", stock.length);
    if (!stock.length) h += `<div class="empty"><p>Nothing in stock yet.</p></div>`;
    else {
      h += `<div class="cat-summary">`;
      CAT_ORDER.forEach((c) => { const n = stock.filter((i) => i.category === c).length; if (n) h += `<div class="cat-chip">${CATEGORIES[c].emoji} ${CATEGORIES[c].label}<span class="n">${n}</span></div>`; });
      h += `</div>`;
    }
    return h + `</div>`;
  }

  // ----- Shopping list -----
  function viewList() {
    const buy = toBuy();
    if (!buy.length) return `<div class="screen">${empty("🛒", "Your shopping list is empty.", "Add something to buy")}</div>`;
    let h = `<div class="screen">`;
    CAT_ORDER.forEach((c) => {
      const rows = buy.filter((i) => i.category === c);
      if (!rows.length) return;
      h += sectionTitle(`${CATEGORIES[c].emoji} ${CATEGORIES[c].label}`, rows.length);
      h += `<div class="card">${rows.map(buyRow).join("")}</div>`;
    });
    return h + `</div>`;
  }
  function buyRow(i) {
    return `<div class="item">
      <div class="check" data-act="buy" data-id="${i.id}"></div>
      <div class="item-body" data-act="edit" data-id="${i.id}">
        <div class="item-name">${esc(i.name)}</div>
        <div class="item-sub">${qtyText(i)}${i.notes ? " · " + esc(i.notes) : ""}${i.addedBy ? " · " + esc(i.addedBy) : ""}</div>
      </div>
      <div class="row-actions"><button class="icon-btn" data-act="del" data-id="${i.id}" aria-label="Delete">🗑</button></div>
    </div>`;
  }

  // ----- Inventory -----
  function viewStock() {
    const stock = inStock().slice().sort((a, b) => { const fa = freshness(a).daysLeft, fb = freshness(b).daysLeft; if (fa == null) return 1; if (fb == null) return -1; return fa - fb; });
    if (!stock.length) return `<div class="screen">${empty("🧺", "Nothing in stock yet.", "Add an item")}</div>`;
    let h = `<div class="screen">`;
    CAT_ORDER.forEach((c) => {
      const rows = stock.filter((i) => i.category === c);
      if (!rows.length) return;
      h += sectionTitle(`${CATEGORIES[c].emoji} ${CATEGORIES[c].label}`, rows.length);
      h += `<div class="card">${rows.map(itemRow).join("")}</div>`;
    });
    return h + `</div>`;
  }
  function itemRow(i) {
    const f = freshness(i);
    const pill = f.reason ? `<span class="pill ${pillClass(f.bucket)}">${f.reason}</span>` : "";
    return `<div class="item">
      <div class="item-emoji">${CATEGORIES[i.category].emoji}</div>
      <div class="item-body" data-act="edit" data-id="${i.id}">
        <div class="item-name">${esc(i.name)}</div>
        <div class="item-sub">${pill}${qtyText(i)}</div>
      </div>
      <div class="row-actions">
        <button class="icon-btn" data-act="used" data-id="${i.id}" title="Used up">✓</button>
        <button class="icon-btn" data-act="bin" data-id="${i.id}" title="Threw away">🗑</button>
      </div>
    </div>`;
  }

  // ----- Spend -----
  function money(n, cur) {
    if (n == null || isNaN(n)) return "—";
    const s = Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return cur ? `${cur} ${s}` : s;
  }
  function spendSince(rs, days) {
    const cut = addDays(startOfToday(), -days + 1);
    return rs.filter((r) => r.date && parseISO(r.date) >= cut).reduce((s, r) => s + (Number(r.total) || 0), 0);
  }
  function viewSpend() {
    const rs = (Data.receipts && Data.receipts()) || [];
    const cur = rs.find((r) => r.currency) ? rs.find((r) => r.currency).currency : "";
    let h = `<div class="screen">`;
    h += `<button class="btn btn--primary" data-act="scan">📸 Scan a bill</button><div style="height:14px"></div>`;
    if (!rs.length) {
      h += empty("💸", "No spend logged yet.", null);
      h += `<div class="card" style="padding:16px"><p class="muted-note">Tap “Scan a bill”, snap your grocery receipt, and it’s read into line items and a total automatically — then logged here.</p></div>`;
      return h + `</div>`;
    }
    h += `<div class="tiles">
      <div class="tile"><div class="big">${money(spendSince(rs, 7), cur)}</div><div class="lbl">This week</div></div>
      <div class="tile"><div class="big">${money(spendSince(rs, 30), cur)}</div><div class="lbl">This month</div></div></div>`;

    // by category (last 30 days)
    const cut = addDays(startOfToday(), -29);
    const byCat = {};
    rs.filter((r) => r.date && parseISO(r.date) >= cut).forEach((r) => (r.items || []).forEach((it) => {
      const c = CATEGORIES[it.category] ? it.category : "other";
      byCat[c] = (byCat[c] || 0) + (Number(it.price) || 0);
    }));
    const cats = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
    if (cats.length) {
      const max = Math.max.apply(null, cats.map((c) => byCat[c]));
      h += sectionTitle("By category · 30 days");
      h += `<div class="card" style="padding:14px">`;
      cats.forEach((c) => {
        const label = CATEGORIES[c] ? `${CATEGORIES[c].emoji} ${CATEGORIES[c].label}` : "🧾 Other";
        const pct = max ? Math.round((byCat[c] / max) * 100) : 0;
        h += `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:14px;font-weight:600;margin-bottom:4px"><span>${label}</span><span>${money(byCat[c], cur)}</span></div>
          <div style="height:8px;background:var(--bg);border-radius:999px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--green);border-radius:999px"></div></div></div>`;
      });
      h += `</div>`;
    }

    h += sectionTitle("Receipts", rs.length);
    h += `<div class="card">`;
    rs.forEach((r) => {
      h += `<div class="item"><div class="item-emoji">🧾</div>
        <div class="item-body"><div class="item-name">${esc(r.store || "Receipt")}</div>
        <div class="item-sub">${esc(r.date || "")} · ${(r.items || []).length} items · added by ${esc(r.createdBy || "")}</div></div>
        <div style="font-weight:700">${money(r.total, r.currency || cur)}</div></div>`;
    });
    h += `</div>`;
    return h + `</div>`;
  }

  // ----- Bill scanning (Gemini OCR via /api/parse-receipt) -----
  function startScan() {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*"; input.setAttribute("capture", "environment");
    input.style.display = "none";
    input.addEventListener("change", () => { const f = input.files && input.files[0]; if (f) onReceiptFile(f); input.remove(); });
    document.body.appendChild(input);
    input.click();
  }
  function downscaleImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        width = Math.round(width * scale); height = Math.round(height * scale);
        const c = document.createElement("canvas"); c.width = width; c.height = height;
        c.getContext("2d").drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        resolve({ base64: c.toDataURL("image/jpeg", quality).split(",")[1], mimeType: "image/jpeg" });
      };
      img.onerror = reject; img.src = url;
    });
  }
  async function onReceiptFile(file) {
    if (location.protocol === "file:") return alert("Scanning works on the hosted app (pantry.aryanbasak.com), not when opening the file directly.");
    toast("Reading bill…");
    try {
      const { base64, mimeType } = await downscaleImage(file, 1280, 0.7);
      const resp = await fetch("/api/parse-receipt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageBase64: base64, mimeType }) });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Scan failed");
      openReceiptReview(data);
    } catch (e) { console.error(e); toast("Couldn't read that bill — try again"); }
  }

  function openReceiptReview(data) {
    const items = (data.items || []).map((it) => Object.assign({ add: it.category !== "other" }, it));
    const m = document.createElement("div");
    m.className = "modal-backdrop";
    const catOpts = (sel) => ["vegetables", "fruits", "meat", "packaged", "dry", "other"].map((c) =>
      `<option value="${c}" ${c === sel ? "selected" : ""}>${CATEGORIES[c] ? CATEGORIES[c].label : "Other"}</option>`).join("");
    m.innerHTML = `<div class="modal" role="dialog">
      <h2>Review bill</h2>
      <div class="row2">
        <div class="field"><label>Store</label><input type="text" id="r-store" value="${esc(data.store || "")}" /></div>
        <div class="field"><label>Date</label><input type="date" id="r-date" value="${esc(data.date || todayISO())}" /></div>
      </div>
      <div class="row2">
        <div class="field"><label>Total</label><input type="number" id="r-total" step="0.01" value="${data.total != null ? data.total : ""}" /></div>
        <div class="field"><label>Currency</label><input type="text" id="r-cur" value="${esc(data.currency || "")}" placeholder="₹, $, €…" /></div>
      </div>
      <div class="section-title">Items <span class="count">· tick to add to inventory</span></div>
      <div class="card" id="r-items">
        ${items.map((it, i) => `<div class="item" data-i="${i}">
          <div class="check ${it.add ? "on" : ""}" data-act="rtoggle" data-i="${i}"></div>
          <div class="item-body" style="display:grid;gap:6px">
            <input type="text" class="ri-name" data-i="${i}" value="${esc(it.name)}" style="font-weight:600" />
            <div style="display:flex;gap:6px">
              <input type="number" class="ri-qty" data-i="${i}" value="${it.qty}" step="0.5" style="width:64px" aria-label="qty" />
              <input type="number" class="ri-price" data-i="${i}" value="${it.price}" step="0.01" style="width:84px" aria-label="price" />
              <select class="ri-cat" data-i="${i}" style="flex:1">${catOpts(it.category)}</select>
            </div>
          </div>
          <button class="icon-btn" data-act="rdel" data-i="${i}" aria-label="Remove">🗑</button>
        </div>`).join("")}
      </div>
      <div style="height:14px"></div>
      <button class="btn btn--primary" data-act="rconfirm">Save spend</button>
      <div style="height:8px"></div>
      <button class="btn btn--ghost btn--sm" data-act="close">Cancel</button>
    </div>`;
    document.body.appendChild(m);
    m._items = items;
    m.addEventListener("click", (e) => {
      if (e.target === m) return closeModal();
      const t = e.target.closest("[data-act]"); if (!t) return;
      const i = t.dataset.i != null ? parseInt(t.dataset.i, 10) : null;
      if (t.dataset.act === "rtoggle") { items[i].add = !items[i].add; t.classList.toggle("on", items[i].add); }
      else if (t.dataset.act === "rdel") { items[i]._removed = true; t.closest(".item").style.display = "none"; }
      else if (t.dataset.act === "rconfirm") confirmReceipt(m, items);
      else if (t.dataset.act === "close") closeModal();
    });
  }
  function confirmReceipt(m, items) {
    const v = (id) => document.getElementById(id);
    const read = (sel, i, num) => { const el = m.querySelector(`.${sel}[data-i="${i}"]`); return el ? (num ? parseFloat(el.value) || 0 : el.value) : null; };
    const date = v("r-date").value || todayISO();
    const cur = v("r-cur").value.trim();
    const finalItems = items.map((it, i) => it._removed ? null : { name: read("ri-name", i), qty: read("ri-qty", i, true) || 1, price: read("ri-price", i, true), category: read("ri-cat", i), add: it.add }).filter(Boolean);
    Data.addReceipt({ store: v("r-store").value.trim(), date, currency: cur, total: parseFloat(v("r-total").value) || finalItems.reduce((s, it) => s + it.price, 0), items: finalItems.map(({ add, ...rest }) => rest) });
    finalItems.filter((it) => it.add && it.name).forEach((it) => {
      const cat = CATEGORIES[it.category] ? it.category : "packaged";
      Data.add({ id: null, name: it.name, category: cat, qty: it.qty, unit: CATEGORIES[cat].unit, status: "in_stock", addedBy: Data.myName(), purchasedDate: date, expiryDate: null, freshnessDays: CATEGORIES[cat].freshness, notes: "" });
    });
    closeModal(); toast("Spend saved"); setScreen("spend");
  }

  // ----- bits -----
  function sectionTitle(label, count) { return `<div class="section-title">${label}${count != null ? ` <span class="count">· ${count}</span>` : ""}</div>`; }
  function empty(em, text, cta) { return `<div class="empty"><div class="em">${em}</div><p>${text}</p>${cta ? `<button class="btn btn--primary btn--sm" data-act="add">${cta}</button>` : ""}</div>`; }
  function emptyApp() {
    return `<div class="empty">
      <div class="em">🧺🍎</div>
      <p><strong>Welcome!</strong><br>Add things you need to buy, then check them
      off as you shop. We'll warn you before food expires or goes stale.</p>
      <button class="btn btn--primary" data-act="add">＋ Add your first item</button>
      <div style="height:10px"></div>
      <button class="btn btn--ghost btn--sm" data-act="sample">Load some sample items</button>
    </div>`;
  }

  // ---------- Pairing screen (cloud mode, before a kitchen is joined) ----------
  function renderPairing() {
    document.getElementById("screen-title").textContent = "Set up sharing";
    app().innerHTML = `<div class="screen">
      <div class="banner">You're sharing this kitchen with one other person. Create it on
        one phone, then use the code to join from the other.</div>
      <div class="card" style="padding:16px;margin-bottom:14px">
        <h2 style="margin:0 0 12px;font-size:17px">Start a new kitchen</h2>
        <div class="field"><label>Your name</label><input type="text" id="p-name1" placeholder="e.g. Aryan" autocomplete="off" /></div>
        <button class="btn btn--primary" data-act="create-hh">Create our kitchen</button>
      </div>
      <div class="card" style="padding:16px">
        <h2 style="margin:0 0 12px;font-size:17px">Join with a code</h2>
        <div class="field"><label>Your name</label><input type="text" id="p-name2" placeholder="e.g. Sam" autocomplete="off" /></div>
        <div class="field"><label>Pairing code</label><input type="text" id="p-code" placeholder="6-character code" autocomplete="off" style="text-transform:uppercase" /></div>
        <button class="btn btn--ghost" data-act="join-hh">Join kitchen</button>
      </div>
    </div>`;
  }
  async function doCreate() {
    const name = (document.getElementById("p-name1").value || "").trim();
    try { await Data.createHousehold("Our Kitchen", name); toast("Kitchen created"); setScreen("home"); showCodeOnce(); }
    catch (e) { toast("Could not create — try again"); }
  }
  async function doJoin() {
    const name = (document.getElementById("p-name2").value || "").trim();
    const code = (document.getElementById("p-code").value || "").trim();
    if (!code) return toast("Enter the pairing code");
    try { await Data.joinHousehold(code, name); toast("Joined!"); setScreen("home"); }
    catch (e) { toast("Invalid code"); }
  }
  function showCodeOnce() {
    const code = Data.inviteCode && Data.inviteCode();
    if (code) setTimeout(() => alert(`Your pairing code is ${code}\n\nOpen the app on the other phone, tap Join, and enter this code.`), 300);
  }

  // ---------- Add / Edit form ----------
  let formCat = "vegetables";
  function openForm(editId) {
    const editing = editId ? getItem(editId) : null;
    formCat = editing ? editing.category : "vegetables";
    const directStock = editing ? editing.status !== "to_buy" : false;
    const names = Data.memberNames();
    const meName = Data.myName();
    const m = document.createElement("div");
    m.className = "modal-backdrop";
    m.innerHTML = `<div class="modal" role="dialog">
      <h2>${editing ? "Edit item" : "Add item"}</h2>
      <form id="item-form">
        <div class="field"><label>What do you need?</label>
          <input type="text" id="f-name" placeholder="e.g. Spinach, Chicken, Milk" autocomplete="off" value="${editing ? esc(editing.name) : ""}" required /></div>
        <div class="field"><label>Category</label>
          <div class="chips" id="f-cats">${CAT_ORDER.map((c) => `<button type="button" class="chip ${c === formCat ? "on" : ""}" data-cat="${c}">${CATEGORIES[c].emoji} ${CATEGORIES[c].label}</button>`).join("")}</div></div>
        <div class="row2">
          <div class="field"><label>Quantity</label><input type="number" id="f-qty" min="0" step="0.5" inputmode="decimal" value="${editing && editing.qty != null ? editing.qty : 1}" /></div>
          <div class="field"><label>Unit</label><input type="text" id="f-unit" value="${editing ? esc(editing.unit || "") : CATEGORIES[formCat].unit}" /></div>
        </div>
        <div class="field"><label>Added by</label>
          <div class="chips" id="f-who">${names.map((name) => `<button type="button" class="chip ${(editing ? editing.addedBy === name : name === meName) ? "on" : ""}" data-who="${esc(name)}">${esc(name)}</button>`).join("")}</div></div>
        <div class="toggle-row" style="margin-bottom:16px">
          <span class="t-lbl">Already have it (in stock)</span>
          <label class="switch"><input type="checkbox" id="f-instock" ${directStock ? "checked" : ""} /><span class="slider"></span></label></div>
        <div id="stock-fields" style="${directStock ? "" : "display:none"}">
          <div class="field"><label>Expiry date <span class="muted-note">(optional)</span></label><input type="date" id="f-expiry" value="${editing && editing.expiryDate ? editing.expiryDate : ""}" /></div>
          <div class="field"><label>Use within (days) — freshness alert</label><input type="number" id="f-fresh" min="1" step="1" value="${editing ? editing.freshnessDays : CATEGORIES[formCat].freshness}" /></div>
        </div>
        <div class="field"><label>Notes <span class="muted-note">(optional)</span></label><textarea id="f-notes" placeholder="brand, the organic one…">${editing ? esc(editing.notes || "") : ""}</textarea></div>
        <button type="submit" class="btn btn--primary">${editing ? "Save" : "Add to list"}</button>
        ${editing ? `<div style="height:8px"></div><button type="button" class="btn btn--ghost btn--sm" data-act="del-edit" data-id="${editing.id}" style="color:var(--red)">Delete item</button>` : ""}
        <div style="height:8px"></div><button type="button" class="btn btn--ghost btn--sm" data-act="close">Cancel</button>
      </form></div>`;
    document.body.appendChild(m);
    m.querySelector("#f-cats").addEventListener("click", (e) => {
      const b = e.target.closest("[data-cat]"); if (!b) return;
      formCat = b.dataset.cat;
      m.querySelectorAll("#f-cats .chip").forEach((x) => x.classList.toggle("on", x === b));
      if (!editing) { m.querySelector("#f-unit").value = CATEGORIES[formCat].unit; m.querySelector("#f-fresh").value = CATEGORIES[formCat].freshness; }
    });
    m.querySelector("#f-who").addEventListener("click", (e) => { const b = e.target.closest("[data-who]"); if (!b) return; m.querySelectorAll("#f-who .chip").forEach((x) => x.classList.toggle("on", x === b)); });
    m.querySelector("#f-instock").addEventListener("change", (e) => { m.querySelector("#stock-fields").style.display = e.target.checked ? "" : "none"; });
    m.addEventListener("click", (e) => { if (e.target === m) closeModal(); });
    m.querySelector("#item-form").addEventListener("submit", (e) => { e.preventDefault(); saveForm(editing); });
    setTimeout(() => m.querySelector("#f-name").focus(), 60);
  }
  function saveForm(editing) {
    const v = (id) => document.getElementById(id);
    const name = v("f-name").value.trim(); if (!name) return;
    const instock = v("f-instock").checked;
    const whoBtn = document.querySelector("#f-who .chip.on");
    const item = {
      id: editing ? editing.id : null, name, category: formCat,
      qty: parseFloat(v("f-qty").value) || null, unit: v("f-unit").value.trim(),
      status: instock ? "in_stock" : "to_buy",
      addedBy: whoBtn ? whoBtn.dataset.who : Data.myName(),
      purchasedDate: instock ? (editing && editing.purchasedDate ? editing.purchasedDate : todayISO()) : null,
      expiryDate: instock ? (v("f-expiry").value || null) : null,
      freshnessDays: parseInt(v("f-fresh").value, 10) || CATEGORIES[formCat].freshness,
      notes: v("f-notes").value.trim(),
    };
    if (editing) Data.update(item); else Data.add(item);
    closeModal();
    toast(editing ? "Saved" : instock ? "Added to stock" : "Added to list");
    render();
  }
  function closeModal() { const m = document.querySelector(".modal-backdrop"); if (m) m.remove(); }

  // ---------- Settings ----------
  function openSettings() {
    const cloud = Data.mode() === "cloud";
    const names = Data.memberNames();
    const code = Data.inviteCode && Data.inviteCode();
    const m = document.createElement("div");
    m.className = "modal-backdrop";
    m.innerHTML = `<div class="modal" role="dialog">
      <h2>Settings</h2>
      ${cloud
        ? `<div class="banner">✅ Shared kitchen${code ? ` · code <strong>${esc(code)}</strong>` : ""}</div>
           ${code ? `<p class="muted-note">Share this code with your partner so they can join from their phone.</p><div style="height:10px"></div>` : ""}
           <div class="field"><label>Your name</label><input type="text" id="s-me" value="${esc(Data.myName())}" /></div>
           <button class="btn btn--primary" data-act="save-settings">Save</button>
           <div class="toggle-row" style="margin-top:16px">
             <span class="t-lbl">🔔 Morning alerts</span>
             <label class="switch"><input type="checkbox" id="s-alerts" /><span class="slider"></span></label>
           </div>
           <p class="muted-note" style="margin-top:8px">A daily nudge when items need eating. On iPhone, add the app to your Home Screen first.</p>`
        : `<div class="banner">Local mode · data is on this device only. (Sharing turns on once Supabase anonymous sign-ins are enabled.)</div>
           <div class="field"><label>Your name</label><input type="text" id="s-me" value="${esc(names[0])}" /></div>
           <div class="field"><label>Partner's name</label><input type="text" id="s-partner" value="${esc(names[1] || "Partner")}" /></div>
           <button class="btn btn--primary" data-act="save-settings">Save</button>`}
      <div style="height:14px"></div><div class="divider"></div>
      <button class="btn btn--ghost btn--sm" data-act="sample">Load sample items</button>
      <div style="height:8px"></div>
      <button class="btn btn--ghost btn--sm" data-act="reset" style="color:var(--red)">${cloud ? "Leave kitchen / clear" : "Clear all data"}</button>
      <div style="height:8px"></div>
      <button class="btn btn--ghost btn--sm" data-act="close">Close</button>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => { if (e.target === m) closeModal(); });
    const alerts = m.querySelector("#s-alerts");
    if (alerts) {
      alerts.checked = (typeof Notification !== "undefined" && Notification.permission === "granted");
      alerts.addEventListener("change", async (e) => {
        if (e.target.checked) { const ok = await enableNotifications(); e.target.checked = ok; }
        else { await disableNotifications(); }
      });
    }
  }

  // ---------- Push notifications ----------
  function urlBase64ToUint8Array(base64) {
    const pad = "=".repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  async function enableNotifications() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") { toast("Not supported on this device"); return false; }
    if (Data.mode() !== "cloud" || !Data.pushSupported()) { toast("Turn on sharing first"); return false; }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { toast("Notifications blocked"); return false; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(window.PANTRY_CONFIG.vapidPublic) });
      await Data.saveSubscription(sub.toJSON());
      toast("Morning alerts on"); return true;
    } catch (e) { console.error(e); toast("Couldn't enable alerts"); return false; }
  }
  async function disableNotifications() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await Data.removeSubscription(sub.endpoint); await sub.unsubscribe(); }
      toast("Alerts off");
    } catch (_) {}
  }

  async function saveSettings() {
    if (Data.mode() === "cloud") { await Data.setMyName(document.getElementById("s-me").value); }
    else { Data.setLocalNames(document.getElementById("s-me").value.trim(), document.getElementById("s-partner").value.trim()); }
    closeModal(); toast("Saved"); render();
  }

  // ---------- Sample data ----------
  function loadSample() {
    const t = startOfToday(); const iso = (n) => toISO(addDays(t, n));
    const mk = (name, category, qty, unit, status, extra) => Object.assign({ id: null, name, category, qty, unit, status, addedBy: Data.myName(), purchasedDate: null, expiryDate: null, freshnessDays: CATEGORIES[category].freshness, notes: "" }, extra);
    Data.loadSample([
      mk("Spinach", "vegetables", 1, "bunch", "in_stock", { purchasedDate: iso(-4) }),
      mk("Chicken breast", "meat", 0.5, "kg", "in_stock", { purchasedDate: iso(-2) }),
      mk("Strawberries", "fruits", 1, "box", "in_stock", { purchasedDate: iso(-5) }),
      mk("Milk", "packaged", 1, "carton", "in_stock", { purchasedDate: iso(-1), expiryDate: iso(2) }),
      mk("Rice", "dry", 5, "kg", "in_stock", { purchasedDate: iso(-10) }),
      mk("Bananas", "fruits", 6, "pcs", "to_buy", {}),
      mk("Pasta", "dry", 2, "pack", "to_buy", {}),
      mk("Tomatoes", "vegetables", 1, "kg", "to_buy", {}),
    ]);
    closeModal(); toast("Sample items loaded"); setScreen("home");
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg) { const el = document.getElementById("toast"); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 1800); }

  // ---------- Event delegation ----------
  document.addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (tab) { setScreen(tab.dataset.screen); return; }
    const el = e.target.closest("[data-act]"); if (!el) return;
    const act = el.dataset.act; const id = el.dataset.id;
    switch (act) {
      case "go": setScreen(el.dataset.screen); break;
      case "add": openForm(); break;
      case "edit": openForm(id); break;
      case "del": Data.remove(id); render(); toast("Removed"); break;
      case "del-edit": Data.remove(id); closeModal(); render(); toast("Deleted"); break;
      case "buy": el.classList.add("on"); setTimeout(() => { moveToStock(id); render(); toast("Moved to stock"); }, 220); break;
      case "used": markUsed(id, false); render(); toast("Used up — nice"); break;
      case "bin": markUsed(id, true); render(); toast("Binned"); break;
      case "sample": loadSample(); break;
      case "scan": startScan(); break;
      case "save-settings": saveSettings(); break;
      case "create-hh": doCreate(); break;
      case "join-hh": doJoin(); break;
      case "import": Data.importLocalItems().then(() => { render(); toast("Imported"); }); break;
      case "skip-import": Data.skipImport(); render(); break;
      case "reset": if (confirm("Clear all data on this device?")) { Data.reset().then(() => { setScreen("home"); toast("Cleared"); }); } break;
      case "close": closeModal(); break;
    }
  });
  document.getElementById("profile-btn").addEventListener("click", openSettings);

  // ---------- Service worker ----------
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }

  // ---------- Boot ----------
  Data.onChange(() => render());
  Data.init().then(() => setScreen("home")).catch(() => setScreen("home"));
})();
