const { google: cfg } = require("./config");

async function getEmb(text) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.embModel}:embedContent?key=${cfg.key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.embModel,
      content: { parts: [{ text }] },
      outputDimensionality: 2000
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google Embedding Error: ${data.error?.message || res.statusText}`);
  if (!data.embedding) throw new Error("Google API returned no embedding.");
  return data.embedding.values;
}

async function getAnswer(model, history, prompt) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cfg.key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] })),
        { role: "user", parts: [{ text: prompt }] }
      ],
      generationConfig: { response_mime_type: "application/json", temperature: 0.0 }
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google Generate Error: ${data.error?.message || res.statusText}`);
  return data;
}

module.exports = { getEmb, getAnswer };
