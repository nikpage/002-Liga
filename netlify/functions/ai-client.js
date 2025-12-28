const { google: cfg } = require("./config");

async function getEmb(text) {
  // Fixed: Forced outputDimensionality to exactly 1536
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.embModel}:embedContent?key=${cfg.key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${cfg.embModel}`,
      content: { parts: [{ text }] },
      outputDimensionality: 1536
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Google Embedding Error: ${data.error?.message || res.statusText}`);
  if (!data.embedding) throw new Error("Google API returned no embedding.");

  // Verification: Ensure the array length is exactly 1536
  if (data.embedding.values.length !== 1536) {
    throw new Error(`Dimension Mismatch: API returned ${data.embedding.values.length}, expected 1536.`);
  }

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
