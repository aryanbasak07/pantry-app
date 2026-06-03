// Shared Gemini caller with retry/backoff + model fallback. Files starting with
// "_" are not routes on Vercel but are bundled into functions that require them.
const DEFAULT_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function generate(payload, key, opts = {}) {
  const models = opts.models || (process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : DEFAULT_MODELS);
  const maxRetries = opts.retries != null ? opts.retries : 2;
  let lastErr = { code: "none" };
  for (const model of models) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      let r, j;
      try {
        r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        j = await r.json();
      } catch (e) { lastErr = { code: "fetch", message: String((e && e.message) || e) }; await sleep(400 * (attempt + 1)); continue; }
      if (r.ok) return { ok: true, json: j, model };
      const code = j && j.error && j.error.code;
      lastErr = (j && j.error) || { code: r.status };
      if (code === 429 || code === 500 || code === 503) { await sleep(600 * (attempt + 1)); continue; } // transient: retry
      break; // non-transient (400/404…): try the next model
    }
  }
  return { ok: false, error: lastErr };
}

function extractText(j) {
  return (j && j.candidates && j.candidates[0] && j.candidates[0].content &&
    j.candidates[0].content.parts && j.candidates[0].content.parts[0].text) || "";
}

module.exports = { generate, extractText };
