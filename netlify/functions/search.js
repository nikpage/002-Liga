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

    // Build sources from actual retrieved chunks (max 5)
    const sources = [];
    const seenUrls = new Set();

    if (data && data.chunks) {
      data.chunks.forEach((chunk) => {
        if (chunk.url && !seenUrls.has(chunk.url) && sources.length < 5) {
          seenUrls.add(chunk.url);

          let title = chunk.title || chunk.url.split('/').pop();
          title = title
            .replace(/\.(pdf|docx?|xlsx?|txt)$/i, '')
            .replace(/[_-]+/g, ' ')
            .replace(/pujcovny pomucek/gi, 'Půjčovny pomůcek')
            .replace(/^(\w)/, (m) => m.toUpperCase())
            .trim();

          sources.push({ title, url: chunk.url });
        }
      });
    }

    // Get AI answer
    let answer = result.detaily || result.strucne || "Bohužel nemám informace.";

    // Clean up ugly filenames in text (uhrady_ZP.pdf -> Úhrady ZP)
    answer = answer.replace(/\b[\w-]+\.(pdf|docx?|xlsx?|txt)\b/gi, (match) => {
      return match
        .replace(/\.(pdf|docx?|xlsx?|txt)$/i, '')
        .replace(/[_-]+/g, ' ')
        .replace(/pujcovny pomucek/gi, 'Půjčovny pomůcek')
        .replace(/uhrady zp/gi, 'Úhrady ZP')
        .replace(/^(\w)/, (m) => m.toUpperCase())
        .trim();
    });

    // Add [1] after each sentence in content sections
    // Target sentences that end with . ! ? and aren't headers
    let refNum = 1;
    answer = answer.replace(/([^#\n][.!?])(\s+)/g, (match, punct, space) => {
      if (refNum <= sources.length) {
        return `${punct} [${refNum++}]${space}`;
      }
      return match;
    });

    // Add source section
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
