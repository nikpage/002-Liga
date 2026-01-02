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

    const uniqueSources = [];
    const seenUrls = new Set();

    const fileUrls = await getFileUrls(vector);
    if (fileUrls.length) {
      fileUrls.forEach(url => {
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          uniqueSources.push({ titulek: "Ke stažení", url });
        }
      });
    } else if (result.pouzite_zdroje) {
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
        formattedResponse += `• ${s.url}\n`;
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
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ answer: "Chyba." })
    };
  }
};
