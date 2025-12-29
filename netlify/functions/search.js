const { getEmb, getAnswer } = require('./ai-client');
const { getFullContext } = require('./database');
const { google: cfg } = require('./config');

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const { query } = JSON.parse(event.body);
    console.log("1. Getting embedding");

    // Skip translation, use query directly
    const vector = await getEmb(query);
    console.log("2. Embedding done");

    const data = await getFullContext(vector, query);
    console.log("3. Database search done, chunks:", data.chunks.length);

    // Simple response with results
    let response = `Found ${data.chunks.length} results:\n\n`;
    data.chunks.slice(0, 3).forEach((chunk, i) => {
      response += `${i+1}. ${chunk.title}\n`;
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        answer: response,
        metadata: { sources: [] }
      })
    };

  } catch (err) {
    console.error("Function failed:", err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ answer: "Chyba: " + err.message })
    };
  }
};
