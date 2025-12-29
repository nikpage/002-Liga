const { getEmb, getAnswer } = require('./ai-client');
const { getFullContext } = require('./database');
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
    console.log("Query received:", query);

    const vector = await getEmb(query);
    console.log("Embedding generated");

    const data = await getFullContext(vector, query);
    console.log(`Found ${data.chunks.length} chunks`);

    const extractPrompt = buildExtractionPrompt(query, data);
    const extractResponse = await getAnswer(cfg.chatModel, [], extractPrompt);
    const extractContent = extractResponse.candidates[0].content.parts[0].text;

    console.log("AI FULL RESPONSE:", extractContent);

    const result = JSON.parse(extractContent.replace(/```json/g, "").replace(/```/g, "").trim());

    const uniqueSources = [];
    const seenUrls = new Set();
    if (result.pouzite_zdroje) {
      result.pouzite_zdroje.forEach(source => {
        if (source.url && !seenUrls.has(source.url)) {
          seenUrls.add(source.url);
          uniqueSources.push({ titulek: source.title, url: source.url });
        }
      });
    }

    const strucne = result.strucne || "Bohužel nemám konkrétní informace.";
    let formattedResponse = `💡 **Stručné shrnutí**\n${strucne}\n\n`;

    if (result.detaily && result.detaily.length > 5) {
      formattedResponse += `📋 **Podrobnosti**\n${result.detaily}\n\n`;
    }

    if (uniqueSources.length > 0) {
      formattedResponse += `---\n📄 **Použité zdroje**\n`;
      uniqueSources.forEach(s => {
        formattedResponse += `• [${s.titulek}](${s.url})\n`;
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        answer: formattedResponse,
        metadata: { sources: uniqueSources }
      })
    };

  } catch (err) {
    console.error("Error:", err.message, err.stack);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ answer: "Chyba: " + err.message })
    };
  }
};
