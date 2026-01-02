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

    const vector = await getEmb(query);
    const data = await getFullContext(vector, query);

    // HARD RULE: extract ALL file URLs from chunks.content
    const fileUrlRegex = /https?:\/\/[^\s"]+\.(pdf|docx?|xlsx?)/gi;
    const forcedFileUrls = new Set();

    data.chunks.forEach(c => {
      const text = c.text || c.content || "";
      const matches = text.match(fileUrlRegex);
      if (matches) matches.forEach(u => forcedFileUrls.add(u));
    });

    const extractPrompt = buildExtractionPrompt(query, data);
    const extractResponse = await getAnswer(cfg.chatModel, [], extractPrompt);
    const extractContent = extractResponse.candidates[0].content.parts[0].text;

    const result = JSON.parse(
      extractContent.replace(/```json/g, "").replace(/```/g, "").trim()
    );

    const uniqueSources = [];
    const seenUrls = new Set();

    // HARD ENFORCEMENT
    if (forcedFileUrls.size > 0) {
      Array.from(forcedFileUrls).forEach(url => {
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          uniqueSources.push({ titulek: "Ke stažení", url });
        }
      });
    } else if (result.pouzite_zdroje) {
      result.pouzite_zdroje.forEach(source => {
        if (
          source.url &&
          !source.url.endsWith(".md") &&
          !seenUrls.has(source.url)
        ) {
          seenUrls.add(source.url);
          uniqueSources.push({ titulek: source.title, url: source.url });
        }
      });
    }

    const strucne = result.strucne || "Bohužel nemám konkrétní informace.";
    let formattedResponse = `💡 **Stručné shrnutí**\n${strucne}\n\n`;

    if (uniqueSources.length > 0) {
      formattedResponse += `---\n📥 **Ke stažení**\n`;
      uniqueSource
