/* Pantry & Spend — Phase 1 (local-first, no backend).
 * All data lives in localStorage. Sharing / OCR / push come in later phases. */
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

  // ---------- Storage ----------
  const KEY = "pantry.v1";
  const defaultState = () => ({
    items: [],
    members: ["Me", "Partner"],
    me: 0,
    seeded: false,
  });
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return Object.assign(defaultState(), JSON.parse(raw));
    } catch (_) {}
    return defaultState();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
  }

  // ---------- Date helpers ----------
  const DAY = 86400000;
  function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function parseISO(s) { const d = new Date(s + "T00:00:00"); return d; }
  function toISO(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function diffDays(from, to) { return Math.round((to - from) / DAY); }
  const todayISO = () => toISO(startOfToday());

  // ---------- Freshness logic (the "needs attention" rule) ----------
  // Attention when expiry <=2d away (or passed) OR use-by (purchased+freshnessDays) is near.
  function freshness(item) {
    const t = startOfToday();
    const c = [];
    if (item.expiryDate) c.push({ d: diffDays(t, parseISO(item.expiryDate)), kind: "expiry" });
    if (item.purchasedDate) {
      const useBy = addDays(parseISO(item.purchasedDate), item.freshnessDays || 7);
      c.push({ d: diffDays(t, useBy), kind: "fresh" });
    }
    if (!c.length) return { daysLeft: null, bucket: "none", reason: "" };
    c.sort((a, b) => a.d - b.d);
    const { d, kind } = c[0];
    const bucket = d <= 2 ? "attention" : d <= 5 ? "soon" : "fresh";
    return { daysLeft: d, bucket, reason: reasonText(kind, d) };
  }
  function reasonText(kind, d) {
    if (kind === "expiry") {
      if (d < 0) return "Expired";
      if (d === 0) return "Expires today";
      if (d === 1) return "Expires tomorrow";
      return `Expires in ${d}d`;
    }
    if (d < 0) return "Overdue — use now";
    if (d === 0) return "Use today";
    if (d === 1) return "Use by tomorrow";
    return `Use within ${d}d`;
  }
  const pillClass = (b) => b === "attention" ? "pill--red" : b === "soon" ? "pill--amber" : "pill--green";

  // ---------- Selectors ----------
  const byStatus = (s) => state.items.filter((i) => i.status === s);
  const inStock = () => byStatus("in_stock");
  const toBuy = () => byStatus("to_buy");
  function attentionItems() {
    return inStock().filter((i) => freshness(i).bucket === "attention")
      .sort((a, b) => freshness(a).daysLeft - freshness(b).daysLeft);
  }
  function soonItems() {
    return inStock().filter((i) => freshness(i).bucket === "soon")
      .sort((a, b) => freshness(a).daysLeft - freshness(b).daysLeft);
  }

  // ---------- Mutations ----------
  const uid = () => "i" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  function upsert(item) {
    const idx = state.items.findIndex((i) => i.id === item.id);
    if (idx >= 0) state.items[idx] = item; else state.items.push(item);
    save();
  }
  function getItem(id) { return state.items.find((i) => i.id === id); }
  function removeItem(id) { state.items = state.items.filter((i) => i.id !== id); save(); }

  function moveToStock(id) {
    const it = getItem(id);
    if (!it) return;
    it.status = "in_stock";
    if (!it.purchasedDate) it.purchasedDate = todayISO();
    save();
  }
  function markUsed(id, wasted) {
    const it = getItem(id);
    if (!it) return;
    it.status = "used";
    it.wasted = !!wasted;
    it.usedDate = todayISO();
    save();
  }
  function buyAgain(src) {
    upsert({
      id: uid(), name: src.name, category: src.category,
      qty: src.qty, unit: src.unit, status: "to_buy",
      addedBy: state.members[state.me], purchasedDate: null,
      expiryDate: null, freshnessDays: src.freshnessDays,
      notes: src.notes || "", createdAt: Date.now(),
    });
  }

  // ---------- Router ----------
  let screen = "home";
  const TITLES = { home: "Today", list: "Shopping list", stock: "In stock", spend: "Spend" };
  function setScreen(s) {
    if (s === "add") return openForm();
    screen = s;
    document.getElementById("screen-title").textContent = TITLES[s] || "Pantry";
    document.querySelectorAll(".tab").forEach((t) =>
      t.classList.toggle("active", t.dataset.screen === s));
    render();
  }

  // ---------- Render ----------
  const app = () => document.getElementById("app");
  function render() {
    if (screen === "home") app().innerHTML = viewHome();
    else if (screen === "list") app().innerHTML = viewList();
    else if (screen === "stock") app().innerHTML = viewStock();
    else if (screen === "spend") app().innerHTML = viewSpend();
    updateBadges();
  }

  function updateBadges() {
    const setBadge = (id, n) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.hidden = n <= 0;
      el.textContent = n;
    };
    setBadge("badge-list", toBuy().length);
    setBadge("badge-stock", attentionItems().length);
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  const qtyText = (i) => i.qty ? `${i.qty} ${esc(i.unit || "")}`.trim() : esc(i.unit || "");

  // ----- Home -----
  function viewHome() {
    const att = attentionItems(), soon = soonItems(), stock = inStock(), buy = toBuy();
    if (!state.items.length) return emptyApp();

    let h = `<div class="screen">`;
    h += `<div class="tiles">
      <div class="tile ${att.length ? "tile--warn" : ""}" data-act="go" data-screen="stock">
        <div class="big">${att.length}</div><div class="lbl">Need attention</div></div>
      <div class="tile" data-act="go" data-screen="list">
        <div class="big">${buy.length}</div><div class="lbl">To buy</div></div>
    </div>`;

    if (att.length) {
      h += sectionTitle("🔴 Needs attention", att.length);
      h += `<div class="card">${att.map(itemRow).join("")}</div>`;
    }
    if (soon.length) {
      h += sectionTitle("🟡 Expiring soon", soon.length);
      h += `<div class="card">${soon.map(itemRow).join("")}</div>`;
    }

    // In-stock summary by category
    h += sectionTitle("In stock by category", stock.length);
    if (!stock.length) {
      h += `<div class="empty"><p>Nothing in stock yet.</p></div>`;
    } else {
      h += `<div class="cat-summary">`;
      CAT_ORDER.forEach((c) => {
        const n = stock.filter((i) => i.category === c).length;
        if (n) h += `<div class="cat-chip">${CATEGORIES[c].emoji} ${CATEGORIES[c].label}<span class="n">${n}</span></div>`;
      });
      h += `</div>`;
    }
    h += `</div>`;
    return h;
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
    h += `</div>`;
    return h;
  }
  function buyRow(i) {
    return `<div class="item">
      <div class="check" data-act="buy" data-id="${i.id}"></div>
      <div class="item-body" data-act="edit" data-id="${i.id}">
        <div class="item-name">${esc(i.name)}</div>
        <div class="item-sub">${qtyText(i)}${i.notes ? " · " + esc(i.notes) : ""} · added by ${esc(i.addedBy || "")}</div>
      </div>
      <div class="row-actions">
        <button class="icon-btn" data-act="del" data-id="${i.id}" aria-label="Delete">🗑</button>
      </div>
    </div>`;
  }

  // ----- Inventory -----
  function viewStock() {
    const stock = inStock().slice().sort((a, b) => {
      const fa = freshness(a).daysLeft, fb = freshness(b).daysLeft;
      if (fa == null) return 1; if (fb == null) return -1; return fa - fb;
    });
    if (!stock.length) return `<div class="screen">${empty("🧺", "Nothing in stock yet.", "Add an item")}</div>`;
    let h = `<div class="screen">`;
    CAT_ORDER.forEach((c) => {
      const rows = stock.filter((i) => i.category === c);
      if (!rows.length) return;
      h += sectionTitle(`${CATEGORIES[c].emoji} ${CATEGORIES[c].label}`, rows.length);
      h += `<div class="card">${rows.map(itemRow).join("")}</div>`;
    });
    h += `</div>`;
    return h;
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
        <button class="icon-btn" data-act="used" data-id="${i.id}" aria-label="Mark used" title="Used up">✓</button>
        <button class="icon-btn" data-act="bin" data-id="${i.id}" aria-label="Threw away" title="Threw away">🗑</button>
      </div>
    </div>`;
  }

  // ----- Spend (Phase 3 preview) -----
  function viewSpend() {
    return `<div class="screen">
      ${empty("💸", "Spend tracking arrives in Phase 3.", null)}
      <div class="card" style="padding:16px">
        <p class="muted-note">Snap a photo of your grocery bill and Gemini reads it into
        line items and a total — automatically logging what you spent and, if you like,
        adding what you bought straight into your inventory.</p>
        <div class="divider"></div>
        <p class="muted-note">This needs a Gemini API key + the shared backend, so it
        switches on once we wire Phase 3. The shopping list, inventory and freshness
        alerts all work fully offline right now.</p>
      </div>
    </div>`;
  }

  // ----- bits -----
  function sectionTitle(label, count) {
    return `<div class="section-title">${label}${count != null ? ` <span class="count">· ${count}</span>` : ""}</div>`;
  }
  function empty(em, text, cta) {
    return `<div class="empty"><div class="em">${em}</div><p>${text}</p>${
      cta ? `<button class="btn btn--primary btn--sm" data-act="add">${cta}</button>` : ""}</div>`;
  }
  function emptyApp() {
    return `<div class="screen"><div class="empty">
      <div class="em">🧺🍎</div>
      <p><strong>Welcome!</strong><br>Add things you need to buy, then check them
      off as you shop. We'll warn you before food expires or goes stale.</p>
      <button class="btn btn--primary" data-act="add">＋ Add your first item</button>
      <div style="height:10px"></div>
      <button class="btn btn--ghost btn--sm" data-act="sample">Load some sample items</button>
    </div></div>`;
  }

  // ---------- Add / Edit form (modal sheet) ----------
  let formCat = "vegetables";
  function openForm(editId) {
    const editing = editId ? getItem(editId) : null;
    formCat = editing ? editing.category : "vegetables";
    const directStock = editing ? editing.status !== "to_buy" : false;
    const m = document.createElement("div");
    m.className = "modal-backdrop";
    m.innerHTML = `<div class="modal" role="dialog">
      <h2>${editing ? "Edit item" : "Add item"}</h2>
      <form id="item-form">
        <div class="field">
          <label>What do you need?</label>
          <input type="text" id="f-name" placeholder="e.g. Spinach, Chicken, Milk"
            autocomplete="off" value="${editing ? esc(editing.name) : ""}" required />
        </div>
        <div class="field">
          <label>Category</label>
          <div class="chips" id="f-cats">
            ${CAT_ORDER.map((c) => `<button type="button" class="chip ${c === formCat ? "on" : ""}"
              data-cat="${c}">${CATEGORIES[c].emoji} ${CATEGORIES[c].label}</button>`).join("")}
          </div>
        </div>
        <div class="row2">
          <div class="field"><label>Quantity</label>
            <input type="number" id="f-qty" min="0" step="0.5" inputmode="decimal"
              value="${editing && editing.qty != null ? editing.qty : 1}" /></div>
          <div class="field"><label>Unit</label>
            <input type="text" id="f-unit" value="${editing ? esc(editing.unit || "") : CATEGORIES[formCat].unit}" /></div>
        </div>
        <div class="field">
          <label>Added by</label>
          <div class="chips" id="f-who">
            ${state.members.map((name, idx) => `<button type="button" class="chip ${
              (editing ? editing.addedBy === name : idx === state.me) ? "on" : ""}"
              data-who="${esc(name)}">${esc(name)}</button>`).join("")}
          </div>
        </div>

        <div class="toggle-row" style="margin-bottom:16px">
          <span class="t-lbl">Already have it (in stock)</span>
          <label class="switch"><input type="checkbox" id="f-instock" ${directStock ? "checked" : ""} />
            <span class="slider"></span></label>
        </div>

        <div id="stock-fields" style="${directStock ? "" : "display:none"}">
          <div class="field">
            <label>Expiry date <span class="muted-note">(optional — printed date)</span></label>
            <input type="date" id="f-expiry" value="${editing && editing.expiryDate ? editing.expiryDate : ""}" />
          </div>
          <div class="field">
            <label>Use within (days) — freshness alert</label>
            <input type="number" id="f-fresh" min="1" step="1"
              value="${editing ? editing.freshnessDays : CATEGORIES[formCat].freshness}" />
          </div>
        </div>

        <div class="field">
          <label>Notes <span class="muted-note">(optional)</span></label>
          <textarea id="f-notes" placeholder="brand, the organic one…">${editing ? esc(editing.notes || "") : ""}</textarea>
        </div>

        <button type="submit" class="btn btn--primary">${editing ? "Save" : "Add to list"}</button>
        ${editing ? `<div style="height:8px"></div>
          <button type="button" class="btn btn--ghost btn--sm" data-act="del-edit" data-id="${editing.id}"
            style="color:var(--red)">Delete item</button>` : ""}
        <div style="height:8px"></div>
        <button type="button" class="btn btn--ghost btn--sm" data-act="close">Cancel</button>
      </form>
    </div>`;
    document.body.appendChild(m);

    // category chips
    m.querySelector("#f-cats").addEventListener("click", (e) => {
      const b = e.target.closest("[data-cat]"); if (!b) return;
      formCat = b.dataset.cat;
      m.querySelectorAll("#f-cats .chip").forEach((x) => x.classList.toggle("on", x === b));
      if (!editing) {
        m.querySelector("#f-unit").value = CATEGORIES[formCat].unit;
        m.querySelector("#f-fresh").value = CATEGORIES[formCat].freshness;
      }
    });
    // who chips
    m.querySelector("#f-who").addEventListener("click", (e) => {
      const b = e.target.closest("[data-who]"); if (!b) return;
      m.querySelectorAll("#f-who .chip").forEach((x) => x.classList.toggle("on", x === b));
    });
    // in-stock toggle
    m.querySelector("#f-instock").addEventListener("change", (e) => {
      m.querySelector("#stock-fields").style.display = e.target.checked ? "" : "none";
    });
    // backdrop click closes
    m.addEventListener("click", (e) => { if (e.target === m) closeModal(); });
    // submit
    m.querySelector("#item-form").addEventListener("submit", (e) => {
      e.preventDefault();
      saveForm(editing);
    });
    setTimeout(() => m.querySelector("#f-name").focus(), 60);
  }

  function saveForm(editing) {
    const v = (id) => document.getElementById(id);
    const name = v("f-name").value.trim();
    if (!name) return;
    const instock = v("f-instock").checked;
    const whoBtn = document.querySelector("#f-who .chip.on");
    const item = {
      id: editing ? editing.id : uid(),
      name,
      category: formCat,
      qty: parseFloat(v("f-qty").value) || null,
      unit: v("f-unit").value.trim(),
      status: instock ? "in_stock" : "to_buy",
      addedBy: whoBtn ? whoBtn.dataset.who : state.members[state.me],
      purchasedDate: instock ? (editing && editing.purchasedDate ? editing.purchasedDate : todayISO()) : null,
      expiryDate: instock ? (v("f-expiry").value || null) : null,
      freshnessDays: parseInt(v("f-fresh").value, 10) || CATEGORIES[formCat].freshness,
      notes: v("f-notes").value.trim(),
      createdAt: editing ? editing.createdAt : Date.now(),
    };
    upsert(item);
    closeModal();
    toast(editing ? "Saved" : instock ? "Added to stock" : "Added to list");
    render();
  }

  function closeModal() {
    const m = document.querySelector(".modal-backdrop");
    if (m) m.remove();
  }

  // ---------- Settings ----------
  function openSettings() {
    const m = document.createElement("div");
    m.className = "modal-backdrop";
    m.innerHTML = `<div class="modal" role="dialog">
      <h2>Settings</h2>
      <div class="banner">Phase 1 · everything is stored on this device. Sharing,
        bill-scanning &amp; morning alerts come in later phases.</div>
      <div class="field"><label>Your name</label>
        <input type="text" id="s-me" value="${esc(state.members[state.me])}" /></div>
      <div class="field"><label>Partner's name</label>
        <input type="text" id="s-partner" value="${esc(state.members[state.me === 0 ? 1 : 0])}" /></div>
      <button class="btn btn--primary" data-act="save-settings">Save</button>
      <div style="height:14px"></div>
      <div class="divider"></div>
      <button class="btn btn--ghost btn--sm" data-act="sample">Load sample items</button>
      <div style="height:8px"></div>
      <button class="btn btn--ghost btn--sm" data-act="reset" style="color:var(--red)">Clear all data</button>
      <div style="height:8px"></div>
      <button class="btn btn--ghost btn--sm" data-act="close">Close</button>
    </div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => { if (e.target === m) closeModal(); });
  }
  function saveSettings() {
    const me = document.getElementById("s-me").value.trim() || "Me";
    const partner = document.getElementById("s-partner").value.trim() || "Partner";
    state.members = state.me === 0 ? [me, partner] : [partner, me];
    save(); closeModal(); toast("Saved"); render();
  }

  // ---------- Sample data ----------
  function loadSample() {
    const t = startOfToday();
    const iso = (n) => toISO(addDays(t, n));
    state.items = [
      mk("Spinach", "vegetables", 1, "bunch", "in_stock", { purchasedDate: iso(-4) }),
      mk("Chicken breast", "meat", 0.5, "kg", "in_stock", { purchasedDate: iso(-2) }),
      mk("Strawberries", "fruits", 1, "box", "in_stock", { purchasedDate: iso(-5) }),
      mk("Milk", "packaged", 1, "carton", "in_stock", { purchasedDate: iso(-1), expiryDate: iso(2) }),
      mk("Rice", "dry", 5, "kg", "in_stock", { purchasedDate: iso(-10) }),
      mk("Bananas", "fruits", 6, "pcs", "to_buy", {}),
      mk("Pasta", "dry", 2, "pack", "to_buy", {}),
      mk("Tomatoes", "vegetables", 1, "kg", "to_buy", {}),
    ];
    state.seeded = true;
    save(); closeModal(); toast("Sample items loaded"); setScreen("home");
  }
  function mk(name, category, qty, unit, status, extra) {
    return Object.assign({
      id: uid(), name, category, qty, unit, status,
      addedBy: state.members[Math.round(Math.random())],
      purchasedDate: null, expiryDate: null,
      freshnessDays: CATEGORIES[category].freshness,
      notes: "", createdAt: Date.now(),
    }, extra);
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
  }

  // ---------- Event delegation ----------
  document.addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (tab) { setScreen(tab.dataset.screen); return; }

    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    const id = el.dataset.id;

    switch (act) {
      case "go": setScreen(el.dataset.screen); break;
      case "add": openForm(); break;
      case "edit": openForm(id); break;
      case "del": removeItem(id); render(); toast("Removed"); break;
      case "del-edit": removeItem(id); closeModal(); render(); toast("Deleted"); break;
      case "buy":
        el.classList.add("on");
        setTimeout(() => { moveToStock(id); render(); toast("Moved to stock"); }, 220);
        break;
      case "used": markUsed(id, false); render(); toast("Used up — nice"); break;
      case "bin": markUsed(id, true); render(); toast("Binned"); break;
      case "sample": loadSample(); break;
      case "save-settings": saveSettings(); break;
      case "reset":
        if (confirm("Clear all items and settings on this device?")) {
          state = defaultState(); save(); closeModal(); setScreen("home"); toast("Cleared");
        }
        break;
      case "close": closeModal(); break;
    }
  });

  document.getElementById("profile-btn").addEventListener("click", openSettings);

  // ---------- Service worker (install-ready; skips on file://) ----------
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  // ---------- Boot ----------
  setScreen("home");
})();
