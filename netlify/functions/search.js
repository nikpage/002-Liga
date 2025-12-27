const { getEmb, getAnswer } = require("./ai-client");
const { getFullContext } = require("./database");
const { formatPrompt } = require("./prompts");
const { google: cfg } = require("./config");

exports.handler = async (event) => {
  try {
    const { query } = JSON.parse(event.body);

    // 1. Get embedding for the query using Google API
    const vector = await getEmb(query);

    // 2. Fetch context from Supabase using the vector
    const data = await getFullContext(vector);

    // 3. Format the prompt based on your specific JSON schema
    const prompt = formatPrompt(query, data);

    // 4. Generate the answer using the model specified in config.js
    const aiResponse = await getAnswer(cfg.chatModel, [], prompt);

    // 5. Extract the text response from the Google API structure
    const result = aiResponse.candidates[0].content.parts[0].text;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: result
    };
  } catch (err) {
    // Log the error for Netlify debugging but return a clean error object
    console.error("Search Error:", err.message);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
