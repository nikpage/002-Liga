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
    const fileUrls = getFileUrls(data.chunks.slice(0, 10));

    console.log("FILE URLS:", JSON.stringify(fileUrls, null, 2));

    const extractPrompt = buildExtractionPrompt(query, data);
    const extractResponse = await getAnswer(cfg.chatModel, [], extractPrompt);
    const extractContent = extractResponse.candidates[0].content.parts[0].text;

    console.log("CHUNKS:", JSON.stringify(data.chunks, null, 2));
    console.log("AI RESPONSE:", extractContent);

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

    // Extract downloadable files and match to document titles
    const downloads = [];
    const seenDownloads = new Set();

    if (fileUrls && fileUrls.length > 0) {
          fileUrls.forEach((url) => {
            if (!seenDownloads.has(url)) {
              seenDownloads.add(url);

              let title = null;
              // 1. Priority: Find the document_title from the actual database chunks
              const matchingChunk = data.chunks.find(chunk =>
                (chunk.url === url) || (chunk.text && chunk.text.includes(url))
              );

              if (matchingChunk && matchingChunk.title) {
                title = matchingChunk.title;
              } else {
                // 2. Fallback: Clean the filename from the URL string
                title = decodeURIComponent(url.split('/').pop());
              }

              // 3. Final Polish: Apply strict Czech formatting and remove technical marks
              title = title
                .replace(/\.(pdf|docx?|xlsx?)$/i, '')
                .replace(/[_-]+/g, ' ')
                .replace(/pujcovny pomucek/gi, 'Půjčovny pomůcek')
                .replace(/uhrady zp/gi, 'Úhrady ZP')
                .replace(/odvolani/gi, 'Odvolání')
                .replace(/zadost/gi, 'Žádost')
                .replace(/^(\w)/, (m) => m.toUpperCase())
                .trim();

              downloads.push({ title, url });
            }
          });
        }

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

    // Add downloads section
    if (downloads.length > 0) {
      answer += `\n\n---\n# 📥 Ke stažení\n\n`;
      downloads.forEach(d => {
        answer += `• [${d.title}](${d.url})\n`;
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        answer,
        downloads,
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
