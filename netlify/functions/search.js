const { getEmb, getAnswer } = require("./ai-client");
const { getFullContext } = require("./database");
const { formatPrompt } = require("./prompts");
const { google: cfg } = require("./config");

exports.handler = async (event) => {
  try {
    const { query } = JSON.parse(event.body);

    // Get embedding and context
    const vector = await getEmb(query);
    const data = await getFullContext(vector);

    // Build the prompt
    const prompt = formatPrompt(query, data);

    // Call Google Gemini using chatModel from config.js
    const aiResponse = await getAnswer(cfg.chatModel, [], prompt);

    // CRITICAL FIX: Extract using Google's specific structure
    const result = aiResponse.candidates[0].content.parts[0].text;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: result
    };
  } catch (err) {
    return {
      statusCode: 200, // Return 200 with error object so frontend can display it
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
