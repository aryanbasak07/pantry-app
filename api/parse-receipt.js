// Vercel serverless function: receive a receipt image, ask Gemini to parse it
// into structured line items, return JSON. The Gemini key stays server-side
// (set GEMINI_API_KEY in Vercel → Project Settings → Environment Variables).
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST" });
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "GEMINI_API_KEY is not set on the server" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { imageBase64, mimeType } = body;
    if (!imageBase64) return res.status(400).json({ error: "imageBase64 required" });

    const prompt = [
      "You are a grocery receipt parser. Read this receipt image and extract the data.",
      "Return ONLY JSON with this exact shape:",
      '{"store": string|null, "date": "YYYY-MM-DD"|null, "currency": string|null,',
      ' "total": number|null,',
      ' "items": [{"name": string, "qty": number, "price": number,',
      '   "category": "vegetables"|"fruits"|"meat"|"packaged"|"dry"|"other"}]}',
      "Rules:",
      "- price = the line's total amount as a plain number (no currency symbol).",
      "- qty defaults to 1 when not printed.",
      "- Classify each product into one category; use \"other\" if unsure.",
      "- Skip non-product lines (subtotal, tax, change, loyalty) but report the grand total in 'total'.",
      "- If the store name or date is unreadable, use null.",
    ].join("\n");

    const payload = {
      contents: [{ parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType || "image/jpeg", data: imageBase64 } },
      ] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    };

    const model = body.model || process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: "Gemini request failed", detail: j });

    const text =
      (j.candidates && j.candidates[0] && j.candidates[0].content &&
       j.candidates[0].content.parts && j.candidates[0].content.parts[0].text) || "";
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (_) { const m = text.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : null; }
    if (!parsed) return res.status(502).json({ error: "Could not parse model output", raw: text });

    // normalise
    parsed.items = Array.isArray(parsed.items) ? parsed.items.map((it) => ({
      name: String(it.name || "").trim(),
      qty: Number(it.qty) || 1,
      price: Number(it.price) || 0,
      category: ["vegetables", "fruits", "meat", "packaged", "dry"].includes(it.category) ? it.category : "other",
    })).filter((it) => it.name) : [];
    parsed.total = parsed.total != null ? Number(parsed.total) : null;
    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
