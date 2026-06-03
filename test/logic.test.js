// Plain-Node tests for the shared pure logic (no framework). Run: node test/logic.test.js
const assert = require("assert");
const L = require("../src/logic.js");

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log("ok   -", name); } catch (e) { fail++; console.error("FAIL -", name, "\n      ", e.message); } }

const now = new Date("2026-06-03T00:00:00");

// ----- freshness buckets -----
t("use-by today -> attention", () => assert.strictEqual(L.freshness({ purchasedDate: "2026-05-29", freshnessDays: 5 }, now).bucket, "attention"));
t("meat 2 days left -> attention", () => assert.strictEqual(L.freshness({ purchasedDate: "2026-06-02", freshnessDays: 3 }, now).bucket, "attention"));
t("rice well within -> fresh", () => assert.strictEqual(L.freshness({ purchasedDate: "2026-05-24", freshnessDays: 30 }, now).bucket, "fresh"));
t("expiry tomorrow -> attention", () => assert.strictEqual(L.freshness({ expiryDate: "2026-06-04" }, now).bucket, "attention"));
t("expiry in 4 days -> soon", () => assert.strictEqual(L.freshness({ expiryDate: "2026-06-07" }, now).bucket, "soon"));
t("no dates -> none", () => assert.strictEqual(L.freshness({}, now).bucket, "none"));
t("earliest constraint wins", () => assert.strictEqual(L.freshness({ expiryDate: "2026-06-04", purchasedDate: "2026-06-02", freshnessDays: 30 }, now).bucket, "attention"));

// ----- spend math -----
const rs = [
  { date: "2026-06-02", total: 1200, items: [{ price: 40, category: "vegetables" }, { price: 300, category: "meat" }, { price: 860, category: "dry" }] },
  { date: "2026-05-10", total: 200, items: [{ price: 200, category: "fruits" }] },
];
t("spend last 7 days excludes old", () => assert.strictEqual(L.spendSince(rs, 7, now), 1200));
t("spend last 30 days includes both", () => assert.strictEqual(L.spendSince(rs, 30, now), 1400));
t("byCategory meat=300", () => assert.strictEqual(L.spendByCategory(rs, 30, now).meat, 300));
t("byCategory dry=860", () => assert.strictEqual(L.spendByCategory(rs, 30, now).dry, 860));

// ----- validation -----
t("rejects empty name", () => assert.strictEqual(L.validateItem({ name: "", category: "meat" }).ok, false));
t("rejects bad category", () => assert.strictEqual(L.validateItem({ name: "x", category: "zzz" }).ok, false));
t("rejects negative qty", () => assert.strictEqual(L.validateItem({ name: "x", category: "meat", qty: -2 }).ok, false));
t("repairs freshnessDays<1 to 7", () => assert.strictEqual(L.validateItem({ name: "x", category: "meat", freshnessDays: 0 }).cleaned.freshnessDays, 7));
t("accepts a valid item", () => assert.strictEqual(L.validateItem({ name: "Milk", category: "packaged", qty: 1, freshnessDays: 7 }).ok, true));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
