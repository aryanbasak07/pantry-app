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

  // ---------- Shared logic (pure functions live in src/logic.js / window.PantryLogic) ----------
  const L = window.PantryLogic;
  const { startOfToday, parseISO, toISO, addDays, diffDays, todayISO, freshness, reasonText, pillClass, spendSince, spendByCategory, validateItem } = L;

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
  const TITLES = { home: "Today", list: "Shopping list", stock: "In stock", spend: "Spend", meals: "Meals" };
  function setScreen(s) {
    if (s === "add") return openForm();
    screen = s;
    document.getElementById("screen-title").textContent = TITLES[s] || "Pantry";
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.screen === s));
    if (s === "spend" && Data.pullSpend) Data.pullSpend();
    if (s === "meals" && Data.pullMeals) Data.pullMeals();
    render();
  }

  const app = () => document.getElementById("app");
  function render() {
    if (Data.needsPairing && Data.needsPairing()) return renderPairing();
    if (screen === "home") app().innerHTML = viewHome();
    else if (screen === "list") app().innerHTML = viewList();
    else if (screen === "stock") app().innerHTML = viewStock();
    else if (screen === "spend") app().innerHTML = viewSpend();
    else if (screen === "meals") app().innerHTML = viewMeals();
    updateBadges();
  }
  function updateBadges() {
    const setBadge = (id, n) => { const el = document.getElementById(id); if (!el) return; el.hidden = n <= 0; el.textContent = n; };
    setBadge("badge-list", toBuy().length);
    setBadge("badge-stock", attentionItems().length);
    updateSyncStatus();
  }
  function updateSyncStatus() {
    const el = document.getElementById("sync-status"); if (!el || !Data.syncStatus) return;
    const s = Data.syncStatus();
    if (s.state === "local") { el.hidden = true; return; }
    const map = {
      synced: ["sync--ok", "Synced"],
      syncing: ["sync--busy", s.pending > 0 ? `Syncing ${s.pending}…` : "Syncing…"],
      offline: ["sync--off", s.pending > 0 ? `Offline · ${s.pending}` : "Offline"],
    };
    const [cls, label] = map[s.state] || ["sync--ok", "Synced"];
    el.hidden = false; el.className = "sync-status " + cls; el.textContent = label;
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
  // spend category helpers
  function spendCurrency(rs) { const r = rs.find((x) => x.currency); return r ? r.currency : ""; }
  function plainCatLabel(c) { return CATEGORIES[c] ? CATEGORIES[c].label : c === "other" ? "Other" : c; }
  function catLabel(c) { return CATEGORIES[c] ? `${CATEGORIES[c].emoji} ${CATEGORIES[c].label}` : c === "other" ? "🧾 Other" : "🏷️ " + c; }
  function allSpendCats() {
    const base = ["vegetables", "fruits", "meat", "packaged", "dry", "other"];
    const custom = (Data.spendCategories && Data.spendCategories()) || [];
    return base.concat(custom.filter((c) => !base.includes(c)));
  }
  function catOptions(sel) {
    const list = allSpendCats();
    let opts = list.map((c) => `<option value="${esc(c)}" ${c === sel ? "selected" : ""}>${esc(plainCatLabel(c))}</option>`).join("");
    if (sel && list.indexOf(sel) < 0) opts = `<option value="${esc(sel)}" selected>${esc(sel)}</option>` + opts;
    return opts + `<option value="__new__">＋ New category…</option>`;
  }
  // handle the "＋ New category" option in any .ri-cat <select> inside a modal
  function wireCatSelect(m) {
    m.addEventListener("change", (e) => {
      const sel = e.target.closest(".ri-cat"); if (!sel) return;
      if (sel.value === "__new__") {
        const name = (prompt("New category (e.g. Cigarettes):") || "").trim();
        if (name) {
          Data.addSpendCategory(name);
          m.querySelectorAll(".ri-cat").forEach((s) => {
            if (!Array.from(s.options).some((o) => o.value === name)) {
              const o = document.createElement("option"); o.value = name; o.textContent = name;
              s.insertBefore(o, s.options[s.options.length - 1]);
            }
          });
          sel.value = name;
        } else sel.value = sel.dataset.prev || "other";
      }
      sel.dataset.prev = sel.value;
    });
  }

  function viewSpend() {
    const rs = (Data.receipts && Data.receipts()) || [];
    const cur = spendCurrency(rs);
    const members = Data.memberNames();
    let h = `<div class="screen">`;
    h += `<div style="display:flex;gap:10px"><button class="btn btn--primary" data-act="scan">📸 Scan a bill</button><button class="btn btn--ghost" data-act="add-expense">＋ Add expense</button></div><div style="height:14px"></div>`;
    if (!rs.length) {
      h += empty("💸", "No spend logged yet.", null);
      h += `<div class="card" style="padding:16px"><p class="muted-note">Scan a grocery bill, or tap “Add expense” to log anything — with custom categories (Cigarettes, Household…), who paid, and whether it’s shared.</p></div>`;
      return h + `</div>`;
    }
    h += `<div class="tiles">
      <div class="tile"><div class="big">${money(spendSince(rs, 7), cur)}</div><div class="lbl">This week</div></div>
      <div class="tile"><div class="big">${money(spendSince(rs, 30), cur)}</div><div class="lbl">This month</div></div></div>`;

    // Balances (couple accounting)
    if (members.length === 2) {
      const settlements = (Data.settlements && Data.settlements()) || [];
      const bal = L.computeBalances(rs, members, settlements);
      const paid = {}; members.forEach((mn) => (paid[mn] = 0));
      rs.forEach((r) => { if (r.paidBy && paid[r.paidBy] !== undefined) paid[r.paidBy] += Number(r.total) || 0; });
      h += sectionTitle("💑 Balances");
      h += `<div class="card" style="padding:14px">`;
      members.forEach((mn) => { h += `<div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:6px"><span>${esc(mn)} paid</span><strong>${money(paid[mn], cur)}</strong></div>`; });
      h += `<div class="divider" style="margin:10px 0"></div>`;
      h += bal.owe
        ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><span style="font-weight:700">${esc(bal.owe.from)} owes ${esc(bal.owe.to)} <span style="color:var(--green)">${money(bal.owe.amount, cur)}</span></span><button class="btn btn--primary btn--sm" data-act="settle">Settle up</button></div>`
        : `<div class="muted-note" style="font-weight:600">All settled up 👍</div>`;
      h += `</div>`;
    }

    // Budgets
    const budgets = (Data.budgets && Data.budgets()) || [];
    h += sectionTitle("Budgets · this month");
    if (!budgets.length) {
      h += `<div class="card" style="padding:14px"><p class="muted-note" style="margin:0 0 10px">No budgets yet. Cap your monthly spend (overall or per category).</p><button class="btn btn--ghost btn--sm" data-act="set-budgets">Set budgets</button></div>`;
    } else {
      const prog = L.budgetProgress(rs, budgets, L.currentYM()).sort((a, b) => a.category === "TOTAL" ? -1 : b.category === "TOTAL" ? 1 : b.spent - a.spent);
      h += `<div class="card" style="padding:14px">`;
      prog.forEach((p) => {
        const over = p.pct > 100, lbl = p.category === "TOTAL" ? "🧮 Total" : catLabel(p.category), w = Math.min(100, p.pct);
        h += `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:14px;font-weight:600;margin-bottom:4px"><span>${lbl}</span><span style="${over ? "color:var(--red)" : ""}">${money(p.spent, cur)} / ${money(p.budget, cur)}</span></div>
          <div style="height:8px;background:var(--bg);border-radius:999px;overflow:hidden"><div style="height:100%;width:${w}%;background:${over ? "var(--red)" : "var(--green)"};border-radius:999px"></div></div></div>`;
      });
      h += `<button class="btn btn--ghost btn--sm" data-act="set-budgets">Edit budgets</button></div>`;
    }

    // By category (30 days)
    const byCat = spendByCategory(rs, 30);
    const cats = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
    if (cats.length) {
      const max = Math.max.apply(null, cats.map((c) => byCat[c]));
      h += sectionTitle("By category · 30 days");
      h += `<div class="card" style="padding:14px">`;
      cats.forEach((c) => {
        const pct = max ? Math.round((byCat[c] / max) * 100) : 0;
        h += `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:14px;font-weight:600;margin-bottom:4px"><span>${catLabel(c)}</span><span>${money(byCat[c], cur)}</span></div>
          <div style="height:8px;background:var(--bg);border-radius:999px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--green);border-radius:999px"></div></div></div>`;
      });
      h += `</div>`;
    }

    // History (tap to edit)
    h += sectionTitle("History", rs.length);
    h += `<div class="card">`;
    rs.forEach((r) => {
      const tag = r.split === "personal" ? " · personal" : "";
      h += `<div class="item" data-act="edit-receipt" data-id="${r.id}"><div class="item-emoji">🧾</div>
        <div class="item-body"><div class="item-name">${esc(r.store || "Expense")}</div>
        <div class="item-sub">${esc(r.date || "")}${r.paidBy ? " · " + esc(r.paidBy) : ""}${tag}</div></div>
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

  function bindWho(m, prefix) {
    const box = m.querySelector(`#${prefix}-who`);
    if (box) box.addEventListener("click", (e) => { const b = e.target.closest("[data-who]"); if (!b) return; m.querySelectorAll(`#${prefix}-who .chip`).forEach((x) => x.classList.toggle("on", x === b)); });
  }

  // Review a scanned bill (editId omitted) OR edit an existing expense (editId set).
  function openReceiptReview(data, editId) {
    const editing = !!editId;
    const items = (data.items || []).map((it) => Object.assign({ add: !editing && it.category !== "other" && !!CATEGORIES[it.category] }, it));
    const members = Data.memberNames(); const me = Data.myName();
    const sharedChecked = data.split !== "personal";
    const m = document.createElement("div");
    m.className = "modal-backdrop";
    m.innerHTML = `<div class="modal" role="dialog">
      <h2>${editing ? "Edit expense" : "Review bill"}</h2>
      <div class="row2">
        <div class="field"><label>Store / label</label><input type="text" id="r-store" value="${esc(data.store || "")}" /></div>
        <div class="field"><label>Date</label><input type="date" id="r-date" value="${esc(data.date || todayISO())}" /></div>
      </div>
      <div class="row2">
        <div class="field"><label>Total</label><input type="number" id="r-total" step="0.01" value="${data.total != null ? data.total : ""}" /></div>
        <div class="field"><label>Currency</label><input type="text" id="r-cur" value="${esc(data.currency || "")}" placeholder="₹, $, €…" /></div>
      </div>
      ${members.length >= 2 ? `<div class="field"><label>Paid by</label><div class="chips" id="r-who">${members.map((n) => `<button type="button" class="chip ${n === (data.paidBy || me) ? "on" : ""}" data-who="${esc(n)}">${esc(n)}</button>`).join("")}</div></div>
        <div class="toggle-row" style="margin-bottom:16px"><span class="t-lbl">Shared 50/50</span><label class="switch"><input type="checkbox" id="r-shared" ${sharedChecked ? "checked" : ""}/><span class="slider"></span></label></div>` : ""}
      <div class="section-title">Items${editing ? "" : ' <span class="count">· tick to add to inventory</span>'}</div>
      <div class="card" id="r-items">
        ${items.map((it, i) => `<div class="item" data-i="${i}">
          ${editing ? "" : `<div class="check ${it.add ? "on" : ""}" data-act="rtoggle" data-i="${i}"></div>`}
          <div class="item-body" style="display:grid;gap:6px">
            <input type="text" class="ri-name" data-i="${i}" value="${esc(it.name)}" style="font-weight:600" />
            <div style="display:flex;gap:6px">
              <input type="number" class="ri-qty" data-i="${i}" value="${it.qty}" step="0.5" style="width:64px" aria-label="qty" />
              <input type="number" class="ri-price" data-i="${i}" value="${it.price}" step="0.01" style="width:84px" aria-label="price" />
              <select class="ri-cat" data-i="${i}" style="flex:1">${catOptions(it.category)}</select>
            </div>
          </div>
          <button class="icon-btn" data-act="rdel" data-i="${i}" aria-label="Remove">🗑</button>
        </div>`).join("")}
      </div>
      <div style="height:14px"></div>
      <button class="btn btn--primary" data-act="rconfirm">${editing ? "Save changes" : "Save spend"}</button>
      ${editing ? `<div style="height:8px"></div><button class="btn btn--ghost btn--sm" data-act="rdelete" style="color:var(--red)">Delete expense</button>` : ""}
      <div style="height:8px"></div>
      <button class="btn btn--ghost btn--sm" data-act="close">Cancel</button>
    </div>`;
    document.body.appendChild(m);
    wireCatSelect(m); bindWho(m, "r");
    m.addEventListener("click", (e) => {
      if (e.target === m) return closeModal();
      const t = e.target.closest("[data-act]"); if (!t) return;
      const i = t.dataset.i != null ? parseInt(t.dataset.i, 10) : null;
      const act = t.dataset.act;
      if (act === "rtoggle") { items[i].add = !items[i].add; t.classList.toggle("on", items[i].add); }
      else if (act === "rdel") { items[i]._removed = true; t.closest(".item").style.display = "none"; }
      else if (act === "rconfirm") confirmReceipt(m, items, editId);
      else if (act === "rdelete") { if (confirm("Delete this expense?")) { Data.removeReceipt(editId); closeModal(); toast("Deleted"); setScreen("spend"); } }
      else if (act === "close") closeModal();
    });
  }
  function confirmReceipt(m, items, editId) {
    const v = (id) => m.querySelector("#" + id);
    const read = (sel, i, num) => { const el = m.querySelector(`.${sel}[data-i="${i}"]`); return el ? (num ? parseFloat(el.value) || 0 : el.value) : null; };
    const date = v("r-date").value || todayISO();
    const cur = v("r-cur").value.trim();
    const finalItems = items.map((it, i) => it._removed ? null : { name: read("ri-name", i), qty: read("ri-qty", i, true) || 1, price: read("ri-price", i, true), category: read("ri-cat", i) === "__new__" ? "other" : read("ri-cat", i), add: it.add }).filter(Boolean);
    const whoBtn = m.querySelector("#r-who .chip.on");
    const shared = v("r-shared") ? v("r-shared").checked : true;
    const total = parseFloat(v("r-total").value) || finalItems.reduce((s, it) => s + it.price, 0);
    const receipt = { store: v("r-store").value.trim(), date, currency: cur, total, paidBy: whoBtn ? whoBtn.dataset.who : Data.myName(), split: shared ? "shared" : "personal", items: finalItems.map(({ add, ...rest }) => rest) };
    if (editId) { receipt.id = editId; Data.updateReceipt(receipt); }
    else {
      Data.addReceipt(receipt);
      finalItems.filter((it) => it.add && it.name && CATEGORIES[it.category]).forEach((it) => {
        const cat = it.category;
        Data.add({ id: null, name: it.name, category: cat, qty: it.qty, unit: CATEGORIES[cat].unit, status: "in_stock", addedBy: Data.myName(), purchasedDate: date, expiryDate: null, freshnessDays: CATEGORIES[cat].freshness, notes: "" });
      });
    }
    closeModal(); toast(editId ? "Saved" : "Spend saved"); setScreen("spend");
  }

  // ----- Manual expense (quick single entry) -----
  function openExpense() {
    const members = Data.memberNames(); const me = Data.myName();
    const cur = spendCurrency(Data.receipts() || []);
    const m = document.createElement("div");
    m.className = "modal-backdrop";
    m.innerHTML = `<div class="modal" role="dialog">
      <h2>Add expense</h2>
      <div class="field"><label>What for?</label><input type="text" id="e-label" placeholder="e.g. Cigarettes, Dinner out" autocomplete="off" /></div>
      <div class="row2">
        <div class="field"><label>Amount</label><input type="number" id="e-amt" step="0.01" inputmode="decimal" /></div>
        <div class="field"><label>Currency</label><input type="text" id="e-cur" value="${esc(cur)}" placeholder="₹, $…" /></div>
      </div>
      <div class="row2">
        <div class="field"><label>Date</label><input type="date" id="e-date" value="${todayISO()}" /></div>
        <div class="field"><label>Category</label><select id="e-cat" class="ri-cat">${catOptions("other")}</select></div>
      </div>
      ${members.length >= 2 ? `<div class="field"><label>Paid by</label><div class="chips" id="e-who">${members.map((n) => `<button type="button" class="chip ${n === me ? "on" : ""}" data-who="${esc(n)}">${esc(n)}</button>`).join("")}</div></div>
        <div class="toggle-row" style="margin-bottom:16px"><span class="t-lbl">Shared 50/50</span><label class="switch"><input type="checkbox" id="e-shared" checked/><span class="slider"></span></label></div>` : ""}
      <button class="btn btn--primary" data-act="save-expense">Save expense</button>
      <div style="height:8px"></div>
      <button class="btn btn--ghost btn--sm" data-act="close">Cancel</button>
    </div>`;
    document.body.appendChild(m);
    wireCatSelect(m); bindWho(m, "e");
    m.querySelector("#e-label").focus && setTimeout(() => m.querySelector("#e-label").focus(), 60);
    m.addEventListener("click", (e) => { if (e.target === m) return closeModal(); const t = e.target.closest("[data-act]"); if (!t) return; if (t.dataset.act === "save-expense") saveExpense(m); else if (t.dataset.act === "close") closeModal(); });
  }
  function saveExpense(m) {
    const v = (id) => m.querySelector("#" + id);
    const label = v("e-label").value.trim();
    const amt = parseFloat(v("e-amt").value) || 0;
    if (amt <= 0) return toast("Enter an amount");
    let cat = v("e-cat").value; if (cat === "__new__") cat = "other";
    const date = v("e-date").value || todayISO();
    const whoBtn = m.querySelector("#e-who .chip.on");
    const shared = v("e-shared") ? v("e-shared").checked : true;
    const name = label || plainCatLabel(cat);
    Data.addReceipt({ store: name, date, currency: v("e-cur").value.trim(), total: amt, paidBy: whoBtn ? whoBtn.dataset.who : Data.myName(), split: shared ? "shared" : "personal", items: [{ name, qty: 1, price: amt, category: cat }] });
    closeModal(); toast("Expense saved"); setScreen("spend");
  }

  // ----- Budgets -----
  function openBudgets() {
    const budgets = Data.budgets() || []; const getB = (c) => { const b = budgets.find((x) => x.category === c); return b ? b.monthly : ""; };
    const cur = spendCurrency(Data.receipts() || []);
    const cats = ["TOTAL"].concat(allSpendCats());
    const m = document.createElement("div");
    m.className = "modal-backdrop";
    m.innerHTML = `<div class="modal" role="dialog">
      <h2>Monthly budgets${cur ? ` (${esc(cur)})` : ""}</h2>
      <p class="muted-note">Blank or 0 = no budget. “Total” caps overall monthly spend.</p>
      ${cats.map((c) => `<div class="field" style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><label style="flex:1;margin:0">${c === "TOTAL" ? "🧮 Total" : catLabel(c)}</label><input type="number" class="bd-input" data-cat="${esc(c)}" step="1" inputmode="decimal" style="width:120px" value="${getB(c)}" /></div>`).join("")}
      <div style="height:8px"></div>
      <button class="btn btn--primary" data-act="save-budgets">Save</button>
      <div style="height:8px"></div>
      <button class="btn btn--ghost btn--sm" data-act="close">Cancel</button>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => { if (e.target === m) return closeModal(); const t = e.target.closest("[data-act]"); if (!t) return; if (t.dataset.act === "save-budgets") { m.querySelectorAll(".bd-input").forEach((inp) => Data.setBudget(inp.dataset.cat, parseFloat(inp.value) || 0)); closeModal(); toast("Budgets saved"); setScreen("spend"); } else if (t.dataset.act === "close") closeModal(); });
  }

  function doSettle() {
    const rs = Data.receipts() || []; const members = Data.memberNames(); const settlements = Data.settlements() || [];
    const bal = L.computeBalances(rs, members, settlements);
    if (!bal.owe) return toast("Nothing to settle");
    if (confirm(`Record that ${bal.owe.from} paid ${bal.owe.to} ${bal.owe.amount}?`)) { Data.addSettlement(bal.owe.from, bal.owe.to, bal.owe.amount); toast("Settled up 👍"); setScreen("spend"); }
  }

  // ----- Meals (recipes + weekly plan) -----
  function next7Days() {
    const today = startOfToday(); const out = []; const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (let i = 0; i < 7; i++) { const d = addDays(today, i); out.push({ iso: toISO(d), dom: d.getDate(), dow: i === 0 ? "Today" : DOW[d.getDay()] }); }
    return out;
  }
  function viewMeals() {
    const recipes = (Data.recipes && Data.recipes()) || [];
    const plan = (Data.mealPlan && Data.mealPlan()) || [];
    const att = attentionItems();
    let h = `<div class="screen">`;
    if (att.length) {
      h += `<div class="banner" style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <span>♻️ ${att.length} item${att.length > 1 ? "s" : ""} to use up — recipe ideas?</span>
        <button class="btn btn--primary btn--sm" data-act="suggest-recipes">Ideas</button></div>`;
    }
    h += `<div style="display:flex;gap:10px">
      <button class="btn btn--primary" data-act="find-recipes">🔍 Find recipes</button>
      <button class="btn btn--ghost" data-act="new-recipe">＋ New recipe</button></div><div style="height:14px"></div>`;

    h += sectionTitle("This week");
    h += `<div class="card">`;
    next7Days().forEach((d) => {
      const meals = plan.filter((p) => p.date === d.iso);
      h += `<div class="item" style="align-items:flex-start">
        <div style="flex:none;width:46px;text-align:center"><div style="font-weight:800;font-size:17px">${d.dom}</div><div class="item-sub">${d.dow}</div></div>
        <div class="item-body">
          ${meals.length ? meals.map((mp) => `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span data-act="open-recipe" data-id="${mp.recipeId || ""}" style="${mp.recipeId ? "text-decoration:underline" : ""}">${esc(mp.title)}</span><button class="icon-btn" data-act="del-meal" data-id="${mp.id}" style="width:28px;height:28px;font-size:13px">✕</button></div>`).join("") : '<span class="item-sub">No meals planned</span>'}
          <button class="btn btn--ghost btn--sm" data-act="add-meal" data-date="${d.iso}" style="margin-top:4px">＋ Add meal</button>
        </div></div>`;
    });
    h += `</div>`;
    if (plan.filter((p) => p.recipeId).length) h += `<div style="height:12px"></div><button class="btn btn--primary" data-act="gen-list">🛒 Generate shopping list from plan</button>`;

    h += sectionTitle("Recipes", recipes.length);
    if (!recipes.length) {
      h += `<div class="card" style="padding:16px"><p class="muted-note">No recipes yet. Tap “Find recipes” for AI ideas (saved so you only search once), or “New recipe” to add your own.</p></div>`;
    } else {
      h += `<div class="card">`;
      recipes.forEach((r) => { h += `<div class="item" data-act="open-recipe" data-id="${r.id}"><div class="item-emoji">${r.source === "ai" ? "✨" : "📖"}</div>
        <div class="item-body"><div class="item-name">${esc(r.name)}</div><div class="item-sub">${(r.ingredients || []).length} ingredients${r.servings ? " · serves " + r.servings : ""}</div></div></div>`; });
      h += `</div>`;
    }
    return h + `</div>`;
  }

  function openAddMeal(date) {
    const recipes = (Data.recipes && Data.recipes()) || [];
    const m = document.createElement("div"); m.className = "modal-backdrop";
    m.innerHTML = `<div class="modal" role="dialog">
      <h2>Add a meal</h2>
      <div class="field"><label>Meal name</label><input type="text" id="mm-title" placeholder="e.g. Pasta — or pick a recipe below" autocomplete="off" /></div>
      <button class="btn btn--primary" data-act="mm-save">Add to plan</button>
      <div style="height:14px"></div>
      ${recipes.length ? `<div class="section-title">Or pick a saved recipe</div><div class="card">${recipes.map((r) => `<div class="item" data-act="mm-pick" data-id="${r.id}"><div class="item-emoji">${r.source === "ai" ? "✨" : "📖"}</div><div class="item-body"><div class="item-name">${esc(r.name)}</div><div class="item-sub">${(r.ingredients || []).length} ingredients</div></div></div>`).join("")}</div>` : ""}
      <div style="height:10px"></div><button class="btn btn--ghost btn--sm" data-act="close">Cancel</button>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => {
      if (e.target === m) return closeModal();
      const t = e.target.closest("[data-act]"); if (!t) return;
      if (t.dataset.act === "mm-save") { const title = m.querySelector("#mm-title").value.trim(); if (!title) return toast("Enter a meal name"); Data.addMeal(date, null, title); closeModal(); toast("Added"); render(); }
      else if (t.dataset.act === "mm-pick") { const r = recipes.find((x) => x.id === t.dataset.id); Data.addMeal(date, r.id, r.name); closeModal(); toast("Added"); render(); }
      else if (t.dataset.act === "close") closeModal();
    });
  }

  function parseIngredient(line) {
    const mt = line.match(/^([\d.]+)\s*([a-zA-Z]*)\s+(.+)$/);
    if (mt) return { name: mt[3].trim(), qty: parseFloat(mt[1]) || 1, unit: mt[2] || "", category: "other" };
    return { name: line, qty: 1, unit: "", category: "other" };
  }
  function openNewRecipe() {
    const m = document.createElement("div"); m.className = "modal-backdrop";
    m.innerHTML = `<div class="modal" role="dialog">
      <h2>New recipe</h2>
      <div class="field"><label>Name</label><input type="text" id="nr-name" autocomplete="off" /></div>
      <div class="field"><label>Servings</label><input type="number" id="nr-serv" value="2" style="width:100px" /></div>
      <div class="field"><label>Ingredients <span class="muted-note">(one per line, e.g. “2 Onion”)</span></label><textarea id="nr-ing" placeholder="2 Onion\n500g Chicken\nRice"></textarea></div>
      <div class="field"><label>Steps <span class="muted-note">(one per line, optional)</span></label><textarea id="nr-steps"></textarea></div>
      <button class="btn btn--primary" data-act="nr-save">Save recipe</button>
      <div style="height:8px"></div><button class="btn btn--ghost btn--sm" data-act="close">Cancel</button>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => {
      if (e.target === m) return closeModal();
      const t = e.target.closest("[data-act]"); if (!t) return;
      if (t.dataset.act === "nr-save") {
        const name = m.querySelector("#nr-name").value.trim(); if (!name) return toast("Enter a name");
        const ings = m.querySelector("#nr-ing").value.split("\n").map((s) => s.trim()).filter(Boolean).map(parseIngredient);
        const steps = m.querySelector("#nr-steps").value.split("\n").map((s) => s.trim()).filter(Boolean);
        Data.addRecipe({ name, servings: parseInt(m.querySelector("#nr-serv").value, 10) || 2, ingredients: ings, steps, source: "manual", tags: [] });
        closeModal(); toast("Recipe saved"); render();
      } else if (t.dataset.act === "close") closeModal();
    });
  }

  async function findRecipes(mode) {
    if (location.protocol === "file:") return alert("Recipe search works on the hosted app (pantry.aryanbasak.com).");
    let query = "";
    if (mode === "search") { query = (prompt("What would you like to cook? (e.g. quick chicken dinner)") || "").trim(); if (!query) return; }
    const ingredients = mode === "suggest" ? attentionItems().map((i) => i.name) : [];
    toast("Asking Gemini…");
    try {
      const resp = await fetch("/api/recipes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, query, ingredients, count: 3 }) });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "failed");
      showRecipeResults(data.recipes || []);
    } catch (e) { console.error(e); toast("Couldn't fetch recipes — try again"); }
  }
  function showRecipeResults(list) {
    if (!list.length) return toast("No recipes found");
    window._foundRecipes = list;
    const m = document.createElement("div"); m.className = "modal-backdrop";
    m.innerHTML = `<div class="modal" role="dialog"><h2>Recipe ideas</h2>
      <p class="muted-note">Tap Save to keep one in your library (no more API calls for it).</p>
      ${list.map((r, i) => `<div class="card" style="padding:14px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><strong>${esc(r.name)}</strong><button class="btn btn--primary btn--sm" data-act="save-recipe" data-i="${i}">Save</button></div>
        <div class="item-sub" style="margin:4px 0 8px">${r.servings ? "serves " + r.servings : ""}${r.time ? " · " + esc(r.time) : ""}</div>
        <div class="muted-note">${(r.ingredients || []).map((it) => esc((it.qty ? it.qty + (it.unit || "") + " " : "") + it.name)).join(", ")}</div>
      </div>`).join("")}
      <button class="btn btn--ghost btn--sm" data-act="close">Close</button></div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => {
      if (e.target === m) return closeModal();
      const t = e.target.closest("[data-act]"); if (!t) return;
      if (t.dataset.act === "save-recipe") { const r = window._foundRecipes[parseInt(t.dataset.i, 10)]; Data.addRecipe({ name: r.name, servings: r.servings, ingredients: r.ingredients, steps: r.steps, source: "ai", tags: [] }); toast("Saved to recipes"); t.textContent = "Saved ✓"; t.disabled = true; }
      else if (t.dataset.act === "close") { closeModal(); render(); }
    });
  }
  function openRecipe(id) {
    if (!id) return;
    const r = (Data.recipes() || []).find((x) => x.id === id); if (!r) return;
    const m = document.createElement("div"); m.className = "modal-backdrop";
    m.innerHTML = `<div class="modal" role="dialog"><h2>${esc(r.name)}</h2>
      <div class="item-sub" style="margin-bottom:10px">${r.servings ? "serves " + r.servings : ""}</div>
      <div class="section-title">Ingredients</div>
      <div class="muted-note" style="line-height:1.9">${(r.ingredients || []).map((it) => "• " + esc((it.qty ? it.qty + (it.unit || "") + " " : "") + it.name)).join("<br>")}</div>
      ${(r.steps && r.steps.length) ? `<div class="section-title">Steps</div><ol class="muted-note" style="line-height:1.7;padding-left:18px">${r.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
      <div style="height:12px"></div>
      <button class="btn btn--ghost btn--sm" data-act="recipe-del" data-id="${r.id}" style="color:var(--red)">Delete recipe</button>
      <div style="height:8px"></div><button class="btn btn--ghost btn--sm" data-act="close">Close</button>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => { if (e.target === m) return closeModal(); const t = e.target.closest("[data-act]"); if (!t) return; if (t.dataset.act === "recipe-del") { if (confirm("Delete this recipe?")) { Data.removeRecipe(r.id); closeModal(); toast("Deleted"); render(); } } else if (t.dataset.act === "close") closeModal(); });
  }
  function generatePlanList() {
    const recipes = Data.recipes() || [];
    const planned = (Data.mealPlan() || []).filter((p) => p.recipeId).map((p) => recipes.find((r) => r.id === p.recipeId)).filter(Boolean);
    if (!planned.length) return toast("Plan some saved recipes first");
    const list = L.shoppingFromPlan(planned, inStock().map((i) => i.name));
    if (!list.length) return toast("You already have everything 🎉");
    list.forEach((it) => { const cat = CATEGORIES[it.category] ? it.category : "packaged"; Data.add({ id: null, name: it.name, category: cat, qty: it.qty || 1, unit: it.unit || CATEGORIES[cat].unit, status: "to_buy", addedBy: Data.myName(), purchasedDate: null, expiryDate: null, freshnessDays: CATEGORIES[cat].freshness, notes: "for meal plan" }); });
    toast(`Added ${list.length} to shopping list`); setScreen("list");
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
    const check = validateItem(item);
    if (!check.ok) { toast(check.errors[0]); return; }
    if (editing) Data.update(check.cleaned); else Data.add(check.cleaned);
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
           ${code ? `<p class="muted-note">Share this code with your partner so they can join from their phone.</p>
             <button class="btn btn--ghost btn--sm" data-act="rotate-code">Generate new code</button><div style="height:12px"></div>` : ""}
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
      ${!isStandalone() ? `<button class="btn btn--ghost btn--sm" data-act="install-now">📲 Install app</button><div style="height:8px"></div>` : ""}
      <button class="btn btn--ghost btn--sm" data-act="sample">Load sample items</button>
      <div style="height:8px"></div>
      <button class="btn btn--ghost btn--sm" data-act="reset" style="color:var(--red)">${cloud ? "Leave kitchen / clear" : "Clear all data"}</button>
      <div style="height:8px"></div>
      <details style="margin-top:6px"><summary class="muted-note" style="cursor:pointer">Diagnostics</summary>
        <pre id="s-diag" style="font-size:11px;white-space:pre-wrap;color:var(--muted);margin:8px 0 0">…</pre></details>
      <div style="height:8px"></div>
      <button class="btn btn--ghost btn--sm" data-act="close">Close</button>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => { if (e.target === m) closeModal(); });
    fillDiag();
    const alerts = m.querySelector("#s-alerts");
    if (alerts) {
      alerts.checked = (typeof Notification !== "undefined" && Notification.permission === "granted");
      alerts.addEventListener("change", async (e) => {
        if (e.target.checked) { const ok = await enableNotifications(); e.target.checked = ok; }
        else { await disableNotifications(); }
      });
    }
  }

  async function fillDiag() {
    const el = document.getElementById("s-diag"); if (!el) return;
    const L = [];
    L.push("platform: " + (isIOS() ? (iosNonSafari() ? "iOS (not Safari)" : "iOS Safari") : "other"));
    L.push("installed (standalone): " + isStandalone());
    L.push("mode: " + Data.mode() + (Data.pushSupported && Data.pushSupported() ? " · paired" : " · not paired"));
    L.push("Notification API: " + (typeof Notification !== "undefined" ? Notification.permission : "unavailable"));
    L.push("Push API: " + (("PushManager" in window) ? "yes" : "no"));
    L.push("install prompt ready: " + !!deferredInstall);
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        L.push("service worker: " + (reg ? (reg.active ? "active" : reg.installing ? "installing" : "registered") : "none"));
        if (reg) { const s = await reg.pushManager.getSubscription(); L.push("push subscription: " + (s ? "yes" : "none")); }
      } else L.push("service worker: unsupported");
    } catch (e) { L.push("sw error: " + e.message); }
    el.textContent = L.join("\n");
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
    // iOS: web push only exists inside the installed Home-Screen app.
    if (isIOS() && !isStandalone()) { showIOSInstallHelp(); return false; }
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") {
      alert(isIOS()
        ? "Notifications need the installed app. Add Pantry to your Home Screen (Safari → Share → Add to Home Screen) and open it from there, then turn alerts on."
        : "This browser doesn't support notifications. Try Chrome, Edge, or Safari.");
      return false;
    }
    if (Data.mode() !== "cloud" || !Data.pushSupported()) { alert("Create or join a shared kitchen first (the pairing step), then enable alerts."); return false; }
    if (Notification.permission === "denied") {
      alert("Notifications are blocked for this app. On iPhone: Settings → Notifications → Pantry → Allow. On Chrome: site settings → Notifications → Allow. Then try again.");
      return false;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { toast("Notifications not allowed"); return false; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(window.PANTRY_CONFIG.vapidPublic) });
      await Data.saveSubscription(sub.toJSON());
      try { await reg.showNotification("Morning alerts are on ✓", { body: "You'll get a daily nudge when food needs eating.", icon: "./public/icon-192.png", badge: "./public/icon-192.png" }); } catch (_) {}
      toast("Morning alerts on"); return true;
    } catch (e) { console.error(e); alert("Couldn't enable alerts: " + ((e && e.message) || e)); return false; }
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

  // ---------- Toast (optional action, e.g. Undo) ----------
  let toastTimer;
  function toast(msg, action) {
    const el = document.getElementById("toast");
    el.innerHTML = ""; el.appendChild(document.createTextNode(msg));
    if (action) {
      const b = document.createElement("button");
      b.className = "toast-action"; b.textContent = action.label;
      b.addEventListener("click", () => { el.hidden = true; clearTimeout(toastTimer); action.fn(); });
      el.appendChild(b);
    }
    el.hidden = false; clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, action ? 5000 : 1800);
  }

  // ---------- Install prompt (Add to Home Screen) ----------
  let deferredInstall = null;
  const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  const installDismissed = () => { try { return localStorage.getItem("pantry.install.dismissed") === "1"; } catch (_) { return false; } };
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; if (!installDismissed()) showInstallBar("prompt"); });
  window.addEventListener("appinstalled", () => { removeInstallBar(); deferredInstall = null; toast("Installed 🎉"); });

  function maybeShowInstallHint() {
    if (isStandalone() || installDismissed()) return;
    if (isIOS()) showInstallBar("ios");           // iOS has no beforeinstallprompt
    // Chrome/Edge/Android: the beforeinstallprompt listener shows the bar when ready.
  }
  const iosNonSafari = () => isIOS() && /crios|fxios|edgios|opios/i.test(navigator.userAgent);
  function showInstallBar(kind) {
    if (isStandalone() || document.getElementById("install-bar")) return;
    const bar = document.createElement("div");
    bar.className = "install-bar"; bar.id = "install-bar";
    bar.innerHTML = kind === "ios"
      ? `<span class="ib-ico">📲</span><div class="ib-txt">Install Pantry on your iPhone<small>Tap to see how — needed for notifications.</small></div>
         <button class="btn btn--primary btn--sm" data-act="ios-help">How</button>
         <button class="btn btn--ghost btn--sm" data-act="install-dismiss" aria-label="Dismiss">✕</button>`
      : `<span class="ib-ico">📲</span><div class="ib-txt">Install Pantry as an app<small>One tap from your home screen + notifications.</small></div>
         <button class="btn btn--primary btn--sm" data-act="install-now">Install</button>
         <button class="btn btn--ghost btn--sm" data-act="install-dismiss" aria-label="Dismiss">✕</button>`;
    document.body.appendChild(bar);
  }
  function removeInstallBar() { const b = document.getElementById("install-bar"); if (b) b.remove(); }

  // iOS can't install programmatically — show step-by-step instructions instead.
  function showIOSInstallHelp() {
    closeModal();
    const m = document.createElement("div");
    m.className = "modal-backdrop";
    m.innerHTML = `<div class="modal" role="dialog">
      <h2>Add Pantry to your Home Screen</h2>
      ${iosNonSafari()
        ? `<div class="banner" style="background:var(--amber-soft);color:var(--amber)">Open this page in <strong>Safari</strong> first — Chrome and other iPhone browsers can't add apps to the Home Screen.</div>`
        : ""}
      <ol class="muted-note" style="font-size:15px;line-height:1.8;padding-left:20px;color:var(--ink)">
        <li>In <strong>Safari</strong>, tap the <strong>Share</strong> button (the square with an ↑ arrow, at the bottom of the screen).</li>
        <li>Scroll down and tap <strong>“Add to Home Screen”</strong>.</li>
        <li>Tap <strong>Add</strong> (top-right).</li>
        <li>Open <strong>Pantry</strong> from your Home Screen icon — <em>not</em> the Safari tab.</li>
        <li>Then come back to <strong>⚙️ Settings → 🔔 Morning alerts</strong> to switch on notifications.</li>
      </ol>
      <p class="muted-note">Notifications on iPhone only work from the installed Home-Screen app (iOS 16.4+).</p>
      <button class="btn btn--primary" data-act="close">Got it</button>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => { if (e.target === m) closeModal(); });
  }

  async function doInstall() {
    if (isStandalone()) { toast("Already installed ✓"); return; }
    if (isIOS()) { showIOSInstallHelp(); return; }
    if (!deferredInstall) {
      alert("No install prompt yet. Reload the page once, then either use this button again or open Chrome's ⋮ menu → “Install Pantry…”. (Chrome marks the app installable a few seconds after loading.)");
      return;
    }
    deferredInstall.prompt();
    const choice = await deferredInstall.userChoice.catch(() => ({ outcome: "dismissed" }));
    deferredInstall = null; removeInstallBar();
    if (choice.outcome !== "accepted") { try { localStorage.setItem("pantry.install.dismissed", "1"); } catch (_) {} }
  }
  function dismissInstall() { try { localStorage.setItem("pantry.install.dismissed", "1"); } catch (_) {} removeInstallBar(); }

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
      case "del": { const it = getItem(id); Data.remove(id); render(); toast("Removed", { label: "Undo", fn: () => { if (it) { Data.update(it); render(); toast("Restored"); } } }); break; }
      case "del-edit": { const it = getItem(id); Data.remove(id); closeModal(); render(); toast("Deleted", { label: "Undo", fn: () => { if (it) { Data.update(it); render(); } } }); break; }
      case "buy": el.classList.add("on"); setTimeout(() => { moveToStock(id); render(); toast("Moved to stock"); }, 220); break;
      case "used": { const prev = Object.assign({}, getItem(id)); markUsed(id, false); render(); toast("Used up — nice", { label: "Undo", fn: () => { Data.update(prev); render(); } }); break; }
      case "bin": { const prev = Object.assign({}, getItem(id)); markUsed(id, true); render(); toast("Binned", { label: "Undo", fn: () => { Data.update(prev); render(); } }); break; }
      case "sample": loadSample(); break;
      case "scan": startScan(); break;
      case "add-expense": openExpense(); break;
      case "set-budgets": openBudgets(); break;
      case "settle": doSettle(); break;
      case "edit-receipt": { const r = (Data.receipts() || []).find((x) => x.id === id); if (r) openReceiptReview(r, r.id); break; }
      case "find-recipes": findRecipes("search"); break;
      case "suggest-recipes": findRecipes("suggest"); break;
      case "new-recipe": openNewRecipe(); break;
      case "add-meal": openAddMeal(el.dataset.date); break;
      case "del-meal": Data.removeMeal(id); render(); break;
      case "open-recipe": openRecipe(id); break;
      case "gen-list": generatePlanList(); break;
      case "save-settings": saveSettings(); break;
      case "create-hh": doCreate(); break;
      case "join-hh": doJoin(); break;
      case "rotate-code": if (confirm("Generate a new pairing code? The old one stops working.")) { Data.rotateInviteCode().then((c) => { closeModal(); openSettings(); toast("New code: " + c); }).catch(() => toast("Couldn't rotate code")); } break;
      case "import": Data.importLocalItems().then(() => { render(); toast("Imported"); }); break;
      case "skip-import": Data.skipImport(); render(); break;
      case "install-now": doInstall(); break;
      case "ios-help": showIOSInstallHelp(); break;
      case "install-dismiss": dismissInstall(); break;
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
  setTimeout(maybeShowInstallHint, 1500);
})();
