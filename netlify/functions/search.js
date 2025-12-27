const { getFullContext } = require('./database.js');
const { rewritePrompt, formatPrompt } = require('./prompts.js');
const { getEmb, getAnswer } = require('./ai-client.js');

function capitalizeTitle(title) {
  if (!title) return '';
  return title.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

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

    // 1. TRANSLATE TYPOS/ROUGH INPUT TO EXPERT TERMS
    const rewriteResult = await getAnswer(model, [], rewritePrompt(query));
    const expertQuery = rewriteResult.candidates[0].content.parts[0].text.trim();

    // 2. SEARCH DATABASE USING EXPERT TERMS
    const vector = await getEmb(expertQuery);
    const context = await getFullContext(vector, query);

    // 3. GENERATE FINAL RESPONSE
    const prompt = formatPrompt(query, context);
    const aiResponse = await getAnswer(model, history, prompt);

    let answer = "V databázi nejsou informace o tomto tématu.";
    let suggestions = [];

    if (aiResponse.candidates?.[0]?.content?.parts?.[0]) {
      const rawText = aiResponse.candidates[0].content.parts[0].text;
      try {
        const cleanedJson = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleanedJson);

        let sections = [];
        if (parsed.strucne?.length > 0) {
          sections.push("**Stručně:**\n\n" + parsed.strucne.map(f => `• ${f}`).join('\n\n'));
        }
        if (parsed.detaily) {
          sections.push("**Detaily:**\n\n" + parsed.detaily);
        }
        if (parsed.vice_informaci) {
          sections.push("**Více informací:**\n\n" + parsed.vice_informaci);
        }

        answer = sections.join('\n\n---\n\n');

        const usedSources = [];
        if (Array.isArray(parsed.pouzite_zdroje)) {
          parsed.pouzite_zdroje.forEach(idx => {
            const chunk = context.chunks[idx - 1];
            if (chunk && chunk.title && chunk.url && !usedSources.find(s => s.url === chunk.url)) {
              usedSources.push({ title: capitalizeTitle(chunk.title), url: chunk.url });
            }
          });
        }

        if (usedSources.length > 0) {
          answer += "\n\n---\n\n**Zdroje:**\n\n" + usedSources.slice(0, 3).map(s => `• [${s.title}](${s.url})`).join('\n\n');
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
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ answer: "Chyba systému.", error: error.message })
    };
  }
};const context = await getFullContext(vector, query);

console.log("CHUNKS RETURNED:", context.chunks.length);
console.log("FIRST 3 CHUNKS:", context.chunks.slice(0,3).map(c => c.title));

const prompt = formatPrompt(query, context);
