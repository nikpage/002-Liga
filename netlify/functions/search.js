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

    const extractPrompt = buildExtractionPrompt(query, data);
    const extractResponse = await getAnswer(cfg.chatModel, [], extractPrompt);
    const extractContent = extractResponse.candidates[0].content.parts[0].text;

    console.log("CHUNKS:", JSON.stringify(data.chunks, null, 2));
    console.log("AI RESPONSE:", extractContent);

    const result = JSON.parse(
      extractContent.replace(/```json/g, "").replace(/```/g, "").trim()
    );

    let answer = result.detaily || result.strucne || "Bohužel nemám informace.";

    answer = answer.replace(/\b[\w-]+\.(pdf|docx?|xlsx?|txt)\b/gi, (match) => {
      return match
        .replace(/\.(pdf|docx?|xlsx?|txt)$/i, '')
        .replace(/[_-]+/g, ' ')
        .replace(/pujcovny pomucek/gi, 'Půjčovny pomůcek')
        .replace(/uhrady zp/gi, 'Úhrady ZP')
        .replace(/^(\w)/, (m) => m.toUpperCase())
        .trim();
    });

    // Get the sources the AI actually used
    const usedSourceIndices = result.used_sources || [];

    // Filter chunks to only those the AI used
    const citedChunks = usedSourceIndices
      .map(idx => data.chunks[idx])
      .filter(chunk => chunk !== undefined);

    const downloads = [];
    const seenDownloads = new Set();

    citedChunks.forEach(chunk => {
      if (chunk.downloads && Array.isArray(chunk.downloads)) {
        chunk.downloads.forEach(item => {
          if (item.source_url && !seenDownloads.has(item.source_url)) {
            seenDownloads.add(item.source_url);

            const ext = item.source_url.split('.').pop().toLowerCase();
            let icon = '';
            if (ext === 'pdf') icon = '📄';
            else if (ext === 'doc' || ext === 'docx') icon = '📝';
            else if (ext === 'xlsx' || ext === 'xls') icon = '📊';
            else icon = '📎';

            let cleanName = item.file_name.replace(/\.[^/.]+$/, "")
                                .replace(/zadanka/gi, 'Žádanka')
                                .replace(/uhrady/gi, 'Úhrady');

            const title = `${icon} ${cleanName}`;
            downloads.push({ title, url: item.source_url });
          }
        });
      }
    });

    const sources = [];
    const seenUrls = new Set();

    if (data && data.chunks) {
      citedChunks.forEach((chunk) => {
        if (chunk.url && !seenUrls.has(chunk.url)) {
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

    if (downloads.length > 0) {
      answer += `\n\n---\n# 📥 Ke stažení\n\n`;
      downloads.forEach(d => {
        answer += `* [${d.title}](${d.url})\n`;
      });
    }

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
