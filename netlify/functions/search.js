const { getEmb, getAnswer } = require("./ai-client");
const { getFullContext } = require("./database");
const { formatPrompt } = require("./prompts");

exports.handler = async (event) => {
  try {
    // 1. Parse the incoming user query
    const { query } = JSON.parse(event.body);
    if (!query) throw new Error("No query provided");

    // 2. Convert query to vector using your Google AI client
    const vector = await getEmb(query);

    // 3. Fetch relevant chunks from Supabase using that vector
    const data = await getFullContext(vector);

    // 4. Format the prompt using your rigid JSON schema in prompts.js
    const prompt = formatPrompt(query, data);

    // 5. Generate the final response using Google Gemini (as defined in ai-client)
    // We pass an empty array for history if this is a single search
    const aiResponse = await getAnswer("gemini-1.5-flash", [], prompt);

    // 6. Extract the JSON content from the Google API response
    const content = aiResponse.candidates[0].content.parts[0].text;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: content // This will be the JSON object defined in prompts.js
    };
  } catch (err) {
    console.error("Handler Error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: err.message,
        stack: err.stack
      })
    };
  }
};
