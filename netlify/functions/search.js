const { getFullContext } = require('./database');
const { formatPrompt } = require('./prompts');
const { getEmb, getAnswer } = require('./ai-client');

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    };
  }

  try {
    const { query, history = [], model = "gemini-2.0-flash-lite" } = JSON.parse(event.body || "{}");

    if (!query) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No query provided" })
      };
    }

    const vector = await getEmb(query);
    const context = await getFullContext(vector, query);
    const prompt = formatPrompt(query, context);
    const aiResponse = await getAnswer(model, history, prompt);

    let answer = "Omlouváme se, nepodařilo se získat odpověď.";
    let suggestions = [];

    if (aiResponse.candidates && aiResponse.candidates[0]) {
      const content = aiResponse.candidates[0].content;
      if (content && content.parts && content.parts[0]) {
        try {
          const parsed = JSON.parse(content.parts[0].text);
          if (parsed.summary) {
            answer = Array.isArray(parsed.summary)
              ? parsed.summary.join('\n\n')
              : parsed.summary;
          }
          if (parsed.detail) {
            answer += '\n\n' + parsed.detail;
          }
        } catch (e) {
          answer = content.parts[0].text;
        }
      }
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ answer, suggestions })
    };

  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        answer: "Došlo k chybě při zpracování dotazu.",
        error: error.message
      })
    };
  }
};
