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

          // Build answer with three sections
          let sections = [];
          if (parsed.strucne && parsed.strucne.length > 0) {
            sections.push("**Stručně:**\n" + parsed.strucne.map(f => `• ${f}`).join('\n'));
          }
          if (parsed.detaily) {
            sections.push("**Detaily:**\n" + parsed.detaily);
          }
          if (parsed.vice_informaci) {
            sections.push("**Více informací:**\n" + parsed.vice_informaci);
          }

          answer = sections.join('\n\n');

          // Extract actual sources used
          const usedSources = [];
          if (parsed.pouzite_zdroje && Array.isArray(parsed.pouzite_zdroje)) {
            parsed.pouzite_zdroje.forEach(idx => {
              const chunk = context.chunks[idx - 1];
              if (chunk && !usedSources.find(s => s.url === chunk.url)) {
                usedSources.push({ title: chunk.title, url: chunk.url });
              }
            });
          }

          // Add sources to answer
          if (usedSources.length > 0) {
            const top3 = usedSources.slice(0, 3);
            const rest = usedSources.slice(3);

            answer += "\n\n**Zdroje:**\n";
            top3.forEach(s => {
              answer += `• [${s.title}](${s.url})\n`;
            });

            if (rest.length > 0) {
              answer += "\n<details><summary>Další zdroje (" + rest.length + ")</summary>\n\n";
              rest.forEach(s => {
                answer += `• [${s.title}](${s.url})\n`;
              });
              answer += "</details>";
            }
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
