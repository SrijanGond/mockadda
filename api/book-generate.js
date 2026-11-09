// Place this file at: api/book-generate.js
// Vercel env vars: GEMINI_API_KEY, GEMINI_MODEL (optional), PROVIDER (gemini default or claude),
// ANTHROPIC_API_KEY, CLAUDE_MODEL (optional)

export const config = { maxDuration: 120 }; // allow up to 2 minutes for slow models

async function callGemini(system, userText, images) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set in Vercel (add it, then redeploy)');
  // GEMINI_MODEL is tried first; if Google is busy (503/429/500), GEMINI_FALLBACK_MODEL (comma list) is tried next
  const models = [process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    ...(process.env.GEMINI_FALLBACK_MODEL || '').split(',').map(m => m.trim()).filter(Boolean)];
  const parts = [...images.map(d => ({ inlineData: { mimeType: 'image/jpeg', data: d } })), { text: userText }];
  let lastMsg = '';
  for (let k = 0; k < models.length; k++) {
    const model = models[k];
    const generationConfig = { responseMimeType: 'application/json', maxOutputTokens: 8192, temperature: 0.3 };
    if (/2\.5-flash/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
    // Optional: less hidden thinking = faster. Set GEMINI_THINKING_LEVEL (e.g. low or minimal) if your model supports it
    if (process.env.GEMINI_THINKING_LEVEL) generationConfig.thinkingConfig = { thinkingLevel: process.env.GEMINI_THINKING_LEVEL };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      signal: AbortSignal.timeout(models.length > 1 ? 55000 : 100000),
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts }],
        generationConfig,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      lastMsg = `Gemini ${r.status}: ${data?.error?.message || 'request failed'} (model: ${model})`;
      if ([429, 500, 503].includes(r.status) && k < models.length - 1) continue; // busy: try the next model
      throw new Error(lastMsg);
    }
    const cand = data.candidates?.[0];
    const out = (cand?.content?.parts || []).map(p => p.text || '').join('');
    if (!out) throw new Error('Gemini returned no text' + (cand?.finishReason ? ` (reason: ${cand.finishReason})` : data.promptFeedback?.blockReason ? ` (blocked: ${data.promptFeedback.blockReason})` : ''));
    return out;
  }
  throw new Error(lastMsg || 'Gemini request failed');
}

async function callClaude(system, userText, images) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set in Vercel');
  const content = [...images.map(d => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d } })), { type: 'text', text: userText }];
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(100000),
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
      max_tokens: 6000,
      system,
      messages: [{ role: 'user', content }],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Claude ${r.status}: ${data?.error?.message || 'request failed'}`);
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

function parseJson(raw) {
  const clean = raw.replace(/```json|```/g, '').trim();
  const a = clean.indexOf('{'), b = clean.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('AI reply was not JSON');
  return JSON.parse(clean.slice(a, b + 1));
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // Diagnostics (open in browser): ?models=1 lists usable models, ?test=1&model=NAME times a tiny request
    const key = process.env.GEMINI_API_KEY;
    try {
      if (!key) return res.status(200).json({ error: 'GEMINI_API_KEY is not set' });
      if (req.query?.models) {
        const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',
          { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15000) });
        const d = await r.json();
        return res.status(200).json({ status: r.status, models: (d.models || [])
          .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
          .map(m => m.name.replace('models/', '')), error: d.error?.message });
      }
      if (req.query?.test) {
        const model = req.query.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        const t = Date.now();
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST', signal: AbortSignal.timeout(40000),
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK' }] }] }),
        });
        const d = await r.json().catch(() => ({}));
        return res.status(200).json({ model, httpStatus: r.status, milliseconds: Date.now() - t,
          reply: d?.candidates?.[0]?.content?.parts?.[0]?.text || d?.error?.message || '' });
      }
    } catch (e) { return res.status(200).json({ error: e.name + ': ' + e.message }); }
    return res.status(405).json({ error: 'POST only' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { text, count = 15, lang = 'English', firstPage = 1 } = body || {};
  const images = (Array.isArray(body?.images) ? body.images : [])
    .filter(s => typeof s === 'string' && s.length > 1000 && s.length < 1800000)
    .map(s => s.replace(/^data:image\/\w+;base64,/, ''))
    .slice(0, 8);

  if (!images.length && (!text || text.length < 200))
    return res.status(400).json({ error: 'Not enough readable text in these pages' });

  const system = `You make revision material for Indian government exam aspirants.
Use ONLY the book content given (text, or photos of book pages that you must read carefully, including Hindi). Never add facts from outside it.
Skip anything that is blurry, cut off, or not clearly stated.
Return ONLY valid JSON, no markdown, in this shape:
{"notes":["key fact"],"mcqs":[{"q":"question","options":["A","B","C","D"],"answer":0,"explain":"one line from the book","page":12}]}
Rules: 8-12 short notes. Exactly ${count} MCQs, 4 options each, answer is the 0-based index of the right option,
one clearly correct answer, plausible wrong options, mix of facts, dates, definitions, cause-effect.
"page" is the page number the fact came from ([Page n] marker for text; for images, image 1 is page ${firstPage}, image 2 is page ${Number(firstPage) + 1}, and so on). Write in ${lang}.`;

  const userText = images.length
    ? `These are ${images.length} photos of consecutive book pages. Read them and follow the rules.`
    : text;

  const provider = (process.env.PROVIDER || 'gemini').toLowerCase();
  const raw = provider === 'claude' ? callClaude : callGemini;
  const call = async (...args) => {
    try { return await raw(...args); }
    catch (e) {
      if (e.name === 'TimeoutError' || e.name === 'AbortError')
        throw new Error('TIMEOUT: the AI model took too long. Try 1 photo, fewer questions, or a lighter model in GEMINI_MODEL');
      throw e;
    }
  };

  try {
    let out, lastErr;
    for (let attempt = 0; attempt < 2 && !out; attempt++) {
      try { out = parseJson(await call(system, userText, images)); } catch (e) { lastErr = e; if (/^TIMEOUT/.test(e.message)) break; }
    }
    if (!out) throw lastErr;

    out.notes = Array.isArray(out.notes) ? out.notes.filter(Boolean) : [];
    out.mcqs = (out.mcqs || []).filter(m =>
      m && m.q && Array.isArray(m.options) && m.options.length === 4 &&
      Number.isInteger(m.answer) && m.answer >= 0 && m.answer < 4 &&
      new Set(m.options).size === 4 && m.explain);
    if (!out.mcqs.length) throw new Error('AI made no valid questions from this content (try clearer pages)');
    return res.status(200).json(out);
  } catch (e) {
    console.error('book-generate failed:', e);
    return res.status(500).json({ error: 'Could not build the set: ' + e.message });
  }
}
