const { google: cfg } = require("./config");
async function getEmb(text) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.embModel}:embedContent?key=${cfg.key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: cfg.embModel, content: { parts: [{ text }] } }) });
  const data = await res.json();
  return data.embedding.values;
}
async function getAnswer(model, history, prompt) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cfg.key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [...history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] })), { role: "user", parts: [{ text: prompt }] }], generationConfig: { response_mime_type: "application/json", temperature: 0.0 } }) });
  return await res.json();
}
module.exports = { getEmb, getAnswer };
