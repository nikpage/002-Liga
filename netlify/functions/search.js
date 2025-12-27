const { getEmb, getAnswer } = require("./ai-client");
const { getFullContext } = require("./database");
const { formatPrompt } = require("./prompts");
const { google: cfg } = require("./config");

exports.handler = async (event) => {
  try {
    const { query } = JSON.parse(event.body);

    // 1. Get embedding for the query
    const vector = await getEmb(query);

    // 2. Fetch context from Supabase
    const data = await getFullContext(vector);

    // 3. Format the rigid JSON prompt
    const prompt = formatPrompt(query, data);

    // 4. Generate answer using the model defined in config.js
    const aiResponse = await getAnswer(cfg.chatModel, [], prompt);

    // 5. Extract and return the JSON content
    const result = aiResponse.candidates[0].content.parts[0].text;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: result
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
