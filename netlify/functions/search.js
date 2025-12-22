const { getEmb, getAnswer } = require("../../src/ai-client");
const { getFullContext } = require("../../src/database");
const { formatPrompt } = require("../../src/prompts");

function json(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    body: JSON.stringify(bodyObj),
  };
}

function extractJsonText(aiResponse) {
  // Gemini JSON mode returns a structured response; we defensively extract text.
  const text =
    aiResponse?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
    aiResponse?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "";
  return String(text || "").trim();
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(204, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const question = String(payload.question || "").trim();
  const history = Array.isArray(payload.history) ? payload.history : [];
  const model = String(payload.model || "gemini-2.0-flash-lite");

  if (!question) return json(400, { error: "Missing question" });

  try {
    const vector = await getEmb(question);
    const ctx = await getFullContext(vector, question);
    const prompt = formatPrompt(question, ctx);

    const ai = await getAnswer(model, history, prompt);
    const raw = extractJsonText(ai);

    let parsed;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }

    const answer =
      parsed?.detail
        ? (Array.isArray(parsed.summary) ? parsed.summary.join("\n") + "\n\n" : "") + parsed.detail
        : raw || "Nepodařilo se vytvořit odpověď.";

    return json(200, { answer });
  } catch (e) {
    return json(500, { error: "Server error" });
  }
};