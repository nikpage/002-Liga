const { getEmb, getAnswer } = require("./ai-client");
const { getFullContext } = require("./database");
const { formatPrompt } = require("./prompts");

exports.handler = async (event) => {
  let step = "Initializing";
  try {
    step = "Parsing Request Body";
    if (!event.body) throw new Error("Request body is empty");
    const { query } = JSON.parse(event.body);
    if (!query) throw new Error("Property 'query' is missing in request");

    step = "Generating Embedding (Google API)";
    // Calls getEmb from ai-client.js using GOOGLE_API_KEY
    const vector = await getEmb(query);

    step = "Fetching Context (Supabase RPC)";
    // Calls match_chunks in Supabase
    const data = await getFullContext(vector);

    step = "Formatting Prompt";
    // Uses the JSON schema defined in prompts.js
    const prompt = formatPrompt(query, data);

    step = "Generating Answer (Gemini API)";
    // Calls Google Gemini via ai-client.js
    const aiResponse = await getAnswer("gemini-1.5-flash", [], prompt);

    step = "Parsing AI Response Structure";
    // Checks if the response actually contains the expected candidates
    if (!aiResponse.candidates || !aiResponse.candidates[0]) {
      throw new Error("Google AI returned no candidates. Check safety filters or quota.");
    }
    const result = aiResponse.candidates[0].content.parts[0].text;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: result
    };
  } catch (err) {
    console.error(`Error at step [${step}]:`, err.message);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: err.message,
        failedAt: step,
        help: "Check Netlify environment variables and Supabase RPC names."
      })
    };
  }
};
