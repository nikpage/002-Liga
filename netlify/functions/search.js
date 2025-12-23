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
    if (!query) return { statusCode: 400, body: JSON.stringify({ error: "No query" }) };

    const vector = await getEmb(query);
    const context = await getFullContext(vector, query);
    const prompt = formatPrompt(query, context);
    const aiResponse = await getAnswer(model, history, prompt);

    let answer = "Omlouváme se, nepodařilo se získat odpověď.";
    let suggestions = [];

    if (aiResponse.candidates?.[0]?.content?.parts?.[0]) {
      const rawText = aiResponse.candidates[0].content.parts[0].text;
      try {
        // Fix: Remove potential markdown code blocks that cause JSON.parse to fail
        const cleanedJson = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleanedJson);

        let sections = [];
        if (parsed.strucne?.length > 0) sections.push("**Stručně:**\n" + parsed.strucne.map(f => `• ${f}`).join('\n'));
        if (parsed.detaily) sections.push("**Detaily:**\n" + parsed.detaily);
        if (parsed.vice_informaci) sections.push("**Více informací:**\n" + parsed.vice_informaci);

        answer = sections.join('\n\n');

        const usedSources = [];
        if (Array.isArray(parsed.pouzite_zdroje)) {
          parsed.pouzite_zdroje.forEach(idx => {
            const chunk = context.chunks[idx - 1];
            if (chunk && !usedSources.find(s => s.url === chunk.url)) {
              usedSources.push({ title: chunk.title, url: chunk.url });
            }
          });
        }

        if (usedSources.length > 0) {
          answer += "\n\n**Zdroje:**\n" + usedSources.slice(0, 3).map(s => `• [${s.title}](${s.url})`).join('\n');
          if (usedSources.length > 3) {
            answer += `\n\n<details><summary>Další zdroje (${usedSources.length - 3})</summary>\n\n` +
                      usedSources.slice(3).map(s => `• [${s.title}](${s.url})`).join('\n') + "\n</details>";
          }
        }
      } catch (e) {
        answer = rawText;
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ answer, suggestions })
    };

  } catch (error) {
    console.error("Critical Error:", error.message);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ answer: "Chyba systému.", error: error.message })
    };
  }
};
