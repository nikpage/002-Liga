const fetch = require('node-fetch');
const config = require("./config");
const { google: cfg } = require("./config");
const crypto = require('crypto');

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

async function getGoogleAccessToken(serviceAccountJson) {
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch (e) {
    throw new Error("Failed to parse Service Account JSON");
  }

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const header = { alg: "RS256", typ: "JWT" };

  // Base64Url encoding helper
  const toBase64Url = (str) => Buffer.from(str).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedClaim = toBase64Url(JSON.stringify(claim));

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${encodedHeader}.${encodedClaim}`);

  // Ensure private key newlines are handled correctly
  const privateKey = serviceAccount.private_key.replace(/\\n/g, '\n');
  const signature = sign.sign(privateKey, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${encodedHeader}.${encodedClaim}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Token Error: ${data.error_description || data.error}`);
  return data.access_token;
}

async function getTTS(text) {
  const apiKeyOrJson = config.google.ttsKey;
  let url = `https://texttospeech.googleapis.com/v1/text:synthesize`;
  let headers = { 'Content-Type': 'application/json' };

  // Check if it's a JSON Service Account Key (starts with {)
  if (apiKeyOrJson && apiKeyOrJson.trim().startsWith('{')) {
    try {
      const token = await getGoogleAccessToken(apiKeyOrJson);
      headers['Authorization'] = `Bearer ${token}`;
      // When using OAuth, we do NOT pass ?key=
    } catch (e) {
      console.error("Failed to generate token from JSON key:", e);
      throw new Error("TTS Auth Failed: Invalid Service Account Key");
    }
  } else {
    // Fallback to standard API Key string
    url += `?key=${apiKeyOrJson}`;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({
      input: { text: text },
      voice: { languageCode: 'cs-CZ', ssmlGender: 'FEMALE' },
      audioConfig: { audioEncoding: 'MP3' }
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`TTS Error: ${data.error?.message || res.statusText}`);

  if (!data.audioContent) throw new Error("No audio content returned from TTS API");

  return Buffer.from(data.audioContent, 'base64');
}

module.exports = { getEmb, getAnswer, getTTS };
