const { getEmb, getAnswer } = require("./ai-client");
const { getFullContext } = require("./database");
const { formatPrompt } = require("./prompts");
const { google: cfg } = require("./config");

exports.handler = async (event) => {
  try {
    const { query } = JSON.parse(event.body);

    const vector = await getEmb(query);
    const data = await getFullContext(vector);
    const prompt = formatPrompt(query, data);
    const aiResponse = await getAnswer(cfg.chatModel, [], prompt);

    let content = aiResponse.candidates[0].content.parts[0].text;
    const cleanJson = content.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleanJson);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answer: parsed.detaily || "Bez odpovědi",
        suggestions: []
      })
    };
  } catch (err) {
    console.error("Function error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: "Chyba: " + err.message })
    };
  }
};
