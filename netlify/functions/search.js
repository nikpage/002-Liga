const { getEmb, getAnswer } = require("./ai-client");
const { getFullContext } = require("./database");
const { formatPrompt } = require("./prompts");
const { google: cfg } = require("./config");

exports.handler = async (event) => {
  try {
    const { query } = JSON.parse(event.body);

    // 1. Get query embedding
    const vector = await getEmb(query);

    // 2. Get data from Supabase
    const data = await getFullContext(vector);

    // 3. Format the prompt
    const prompt = formatPrompt(query, data);

    // 4. Get Gemini answer using model from config
    const aiResponse = await getAnswer(cfg.chatModel, [], prompt);

    // 5. THE FIX: Extract and sanitize the JSON text
    let content = aiResponse.candidates[0].content.parts[0].text;

    // This removes Markdown backticks that cause the "CHYBA SYSTÉMU" error
    const cleanJson = content.replace(/```json/g, "").replace(/```/g, "").trim();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: cleanJson
    };
  } catch (err) {
    console.error("Search Error:", err.message);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
