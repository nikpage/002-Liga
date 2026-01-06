const fetch = require('node-fetch');
const config = require("./config");
const { google: cfg } = require("./config");

async function getEmb(text) {
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

  if (data.embedding.values.length !== 1536) {
    throw new Error(`Dimension Mismatch: API returned ${data.embedding.values.length}, expected 1536.`);
  }

  return data.embedding.values;
}

async function getAnswerGoogle(history, prompt) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.google.chatModel}:generateContent?key=${cfg.key}`, {
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

  // Safety check to prevent hanging
  if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
    throw new Error("Empty or invalid response from AI.");
  }

  return data.candidates[0].content.parts[0].text;
}

async function getAnswerAnthropic(history, prompt) {
  const messages = [];

  history.forEach(h => {
    messages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content });
  });
  messages.push({ role: "user", content: prompt });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.anthropic.key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: config.anthropic.chatModel,
      messages: messages,
      max_tokens: 4096,
      temperature: 0.0
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Anthropic Generate Error: ${data.error?.message || res.statusText}`);

  if (!data.content?.[0]?.text) {
    throw new Error("Empty or invalid response from AI.");
  }

  return data.content[0].text;
}

async function getAnswer(history, prompt) {
  if (config.provider === "google") {
    return await getAnswerGoogle(history, prompt);
  } else if (config.provider === "anthropic") {
    return await getAnswerAnthropic(history, prompt);
  } else {
    throw new Error(`Unknown provider: ${config.provider}`);
  }
}

module.exports = { getEmb, getAnswer };
