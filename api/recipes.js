// Vercel serverless function: ask Gemini for recipes — either "suggest" (use up
// expiring ingredients) or "search" (by query). Returns structured recipes the
// app saves to its library so the API is only called once per search.
module.exports = async (req, res) => {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Use POST" }); }
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "GEMINI_API_KEY is not set on the server" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const n = Math.min(Math.max(parseInt(body.count, 10) || 3, 1), 5);
    const task = body.mode === "suggest"
      ? `Suggest ${n} simple home recipes that use up these ingredients which are about to expire: ${(body.ingredients || []).join(", ")}. Favour recipes that use several of them together.`
      : `Give ${n} simple home recipes for: ${body.query || "a quick weeknight dinner"}.`;
    const prompt = `${task}
Return ONLY a JSON array. Each element:
{"name": string, "servings": number, "time": string,
 "ingredients": [{"name": string, "qty": number, "unit": string,
   "category": "vegetables"|"fruits"|"meat"|"packaged"|"dry"|"other"}],
 "steps": [string]}
Use simple ingredient names ("Onion", "Chicken breast"). qty is a number; unit like "g","ml","pcs","tbsp","cup".`;

    const model = body.model || process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const r = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, responseMimeType: "application/json" } }),
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: "Gemini request failed", detail: j });
    const text = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0].text) || "";
    let parsed; try { parsed = JSON.parse(text); } catch (_) { const m = text.match(/\[[\s\S]*\]/); parsed = m ? JSON.parse(m[0]) : null; }
    if (!Array.isArray(parsed)) return res.status(502).json({ error: "Could not parse recipes", raw: text });

    const cats = ["vegetables", "fruits", "meat", "packaged", "dry"];
    const recipes = parsed.map((rp) => ({
      name: String(rp.name || "Recipe"),
      servings: Number(rp.servings) || 2,
      time: String(rp.time || ""),
      ingredients: Array.isArray(rp.ingredients) ? rp.ingredients.map((it) => ({
        name: String(it.name || "").trim(), qty: Number(it.qty) || 1, unit: String(it.unit || ""),
        category: cats.includes(it.category) ? it.category : "other",
      })).filter((it) => it.name) : [],
      steps: Array.isArray(rp.steps) ? rp.steps.map((s) => String(s)) : [],
    })).filter((rp) => rp.ingredients.length);

    return res.status(200).json({ recipes });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
