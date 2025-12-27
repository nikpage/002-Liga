const { getEmb, getAnswer } = require("./ai-client");
const { getFullContext } = require("./database");
const { formatPrompt } = require("./prompts");
const { google: cfg } = require("./config");

exports.handler = async (event) => {
  try {
    const { query } = JSON.parse(event.body);

    // 1. Get embedding
    const vector = await getEmb(query);

    // 2. Fetch context
    const data = await getFullContext(vector);

    // 3. Build the prompt
    const prompt = formatPrompt(query, data);

    // 4. Get AI response using the centralized model
    const aiResponse = await getAnswer(cfg.chatModel, [], prompt);

    // 5. Extract raw text
    let content = aiResponse.candidates[0].content.parts[0].text;

  
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
    console.error("Critical Failure:", err.message);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "System Error",
        message: err.message,
        details: "Check Google API Quota or Supabase RPC permissions."
      })
    };
  }
};
