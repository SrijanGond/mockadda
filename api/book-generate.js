// Place this file at: api/book-generate.js
// Vercel env vars: GEMINI_API_KEY (required for Gemini), GEMINI_MODEL (optional),
// PROVIDER (optional: gemini default, or claude), ANTHROPIC_API_KEY, CLAUDE_MODEL (optional)

async function callGemini(system, text) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set in Vercel (add it, then redeploy)');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const generationConfig = { responseMimeType: 'application/json', maxOutputTokens: 8192, temperature: 0.3 };
  if (/2\.5-flash/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 }; // no hidden thinking tokens
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${data?.error?.message || 'request failed'} (model: ${model})`);
  const cand = data.candidates?.[0];
  const out = (cand?.content?.parts || []).map(p => p.text || '').join('');
  if (!out) throw new Error('Gemini returned no text' + (cand?.finishReason ? ` (reason: ${cand.finishReason})` : data.promptFeedback?.blockReason ? ` (blocked: ${data.promptFeedback.blockReason})` : ''));
  return out;
}

async function callClaude(system, text) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in Vercel');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
      max_tokens: 6000,
      system,
      messages: [{ role: 'user', content: text }],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Claude ${r.status}: ${data?.error?.message || 'request failed'}`);
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// Pull the JSON object out of the reply even if the AI adds extra words or code fences
function parseJson(raw) {
  const clean = raw.replace(/```json|```/g, '').trim();
  const a = clean.indexOf('{'), b = clean.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('AI reply was not JSON');
  return JSON.parse(clean.slice(a, b + 1));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { text, count = 15, lang = 'English' } = body || {};
  if (!text || text.length < 200) return res.status(400).json({ error: 'Not enough readable text in these pages' });

  const system = `You make revision material for Indian government exam aspirants.
Use ONLY the book text given. Never add facts from outside it. Skip anything the text does not clearly state.
Return ONLY valid JSON, no markdown, in this shape:
{"notes":["key fact"],"mcqs":[{"q":"question","options":["A","B","C","D"],"answer":0,"explain":"one line from the book","page":12}]}
Rules: 8-12 short notes. Exactly ${count} MCQs, 4 options each, answer is the 0-based index of the right option,
one clearly correct answer, plausible wrong options, mix of facts, dates, definitions, cause-effect.
"page" is the [Page n] marker the fact came from. Write in ${lang}.`;

  const provider = (process.env.PROVIDER || 'gemini').toLowerCase();
  const call = provider === 'claude' ? callClaude : callGemini;

  try {
    let out, lastErr;
    for (let attempt = 0; attempt < 2 && !out; attempt++) {   // one automatic retry
      try { out = parseJson(await call(system, text)); } catch (e) { lastErr = e; }
    }
    if (!out) throw lastErr;

    out.notes = Array.isArray(out.notes) ? out.notes.filter(Boolean) : [];
    out.mcqs = (out.mcqs || []).filter(m =>
      m && m.q && Array.isArray(m.options) && m.options.length === 4 &&
      Number.isInteger(m.answer) && m.answer >= 0 && m.answer < 4 &&
      new Set(m.options).size === 4 && m.explain);
    if (!out.mcqs.length) throw new Error('AI made no valid questions from this text (try clearer pages)');
    return res.status(200).json(out);
  } catch (e) {
    console.error('book-generate failed:', e);
    return res.status(500).json({ error: 'Could not build the set: ' + e.message });
  }
}
