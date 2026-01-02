const { getEmb, getAnswer } = require('./ai-client');
const { getFullContext, getFileUrls } = require('./database');
const { google: cfg } = require('./config');
const { buildExtractionPrompt } = require('./prompts');

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

    const vector = await getEmb(query);
    const data = await getFullContext(vector, query);

    const extractPrompt = buildExtractionPrompt(query, data);
    const extractResponse = await getAnswer(cfg.chatModel, [], extractPrompt);
    const extractContent = extractResponse.candidates[0].content.parts[0].text;

    const result = JSON.parse(
      extractContent.replace(/```json/g, "").replace(/```/g, "").trim()
    );

    // Build clean source list (max 5)
    const sources = [];
    const seenUrls = new Set();

    if (result.pouzite_zdroje) {
      result.pouzite_zdroje.slice(0, 5).forEach(source => {
        if (source.url && !seenUrls.has(source.url)) {
          seenUrls.add(source.url);
          // Clean up filename to readable title
          let title = source.title || source.url.split('/').pop();
          title = title
            .replace(/\.(pdf|docx?|xlsx?|txt)$/i, '')
            .replace(/[_-]+/g, ' ')
            .replace(/pujcovny pomucek/gi, 'Půjčovny pomůcek')
            .replace(/^(\w)/, (m) => m.toUpperCase())
            .trim();

          sources.push({ title, url: source.url });
        }
      });
    }

    // Use AI's output directly (it already has emoji sections formatted)
    let answer = result.detaily || result.strucne || "Bohužel nemám informace.";

    // Add source section at bottom
    if (sources.length > 0) {
      answer += `\n\n---\n# 📄 Zdroje\n\n`;
      sources.forEach((s, i) => {
        answer += `${i + 1}. [${s.title}](${s.url})\n`;
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        answer,
        metadata: { sources }
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ answer: "Chyba." })
    };
  }
};
