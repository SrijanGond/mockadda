// Vercel serverless function. Choose the AI with env vars:
//   PROVIDER = gemini (default, free key for testing) or claude
//   GEMINI_API_KEY, GEMINI_MODEL (default gemini-2.5-flash)
//   ANTHROPIC_API_KEY, CLAUDE_MODEL (default claude-sonnet-5-5)

async function callGemini(system, text) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8000 },
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || 'Gemini request failed');
  return (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
}

async function callClaude(system, text) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
      max_tokens: 6000,
      system,
      messages: [{ role: 'user', content: text }],
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || 'Claude request failed');
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { text, count = 15, lang = 'English' } = req.body || {};
  if (!text || text.length < 200) return res.status(400).json({ error: 'Not enough text in these pages' });

  const system = `You make revision material for Indian government exam aspirants.
Use ONLY the book text given. Never add facts from outside it. Skip anything the text does not clearly state.
Return ONLY valid JSON, no markdown, in this shape:
{"notes":["key fact", ...],"mcqs":[{"q":"","options":["","","",""],"answer":0,"explain":"one line, quoting the book's fact","page":12}]}
Rules: 8-12 short notes. Exactly ${count} MCQs, 4 options each, answer is the 0-based index of the right option,
one clearly correct answer, plausible wrong options, mix of facts/dates/definitions/cause-effect.
"page" is the [Page n] marker the fact came from. Write in ${lang}.`;

  try {
    const provider = (process.env.PROVIDER || 'gemini').toLowerCase();
    const raw = provider === 'claude' ? await callClaude(system, text) : await callGemini(system, text);
    const out = JSON.parse(raw.replace(/```json|```/g, '').trim());

    // Validate every question; drop broken ones instead of showing them
    out.notes = Array.isArray(out.notes) ? out.notes : [];
    out.mcqs = (out.mcqs || []).filter(m =>
      m.q && Array.isArray(m.options) && m.options.length === 4 &&
      Number.isInteger(m.answer) && m.answer >= 0 && m.answer < 4 &&
      new Set(m.options).size === 4 && m.explain);
    if (!out.mcqs.length) return res.status(502).json({ error: 'No valid questions made' });
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: 'Could not build the set' });
  }
}
