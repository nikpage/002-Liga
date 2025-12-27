const { getEmb, getAnswer } = require("./ai-client");
const { getFullContext } = require("./database");
const { formatPrompt } = require("./prompts");
const { google: cfg } = require("./config");

exports.handler = async (event) => {
  try {
    const { query } = JSON.parse(event.body);

    // 1. Get query embedding using text-embedding-004
    const vector = await getEmb(query);

    // 2. Fetch the 15 most relevant chunks from Supabase
    const data = await getFullContext(vector);

    // 3. Create the prompt with your JSON schema
    const prompt = formatPrompt(query, data);

    // 4. Get answer from gemini-2.0-flash-lite
    const aiResponse = await getAnswer(cfg.chatModel, [], prompt);

    // 5. Extract and clean the AI response
    let content = aiResponse.candidates[0].content.parts[0].text;

    // This stops the "CHYBA SYSTÉMU" error by removing Markdown backticks
    const cleanJson = content.replace(/```json/g, "").replace(/```/g, "").trim();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: cleanJson
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
