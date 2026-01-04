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
    console.log("FUNCTION STARTED - QUERY:", query);

    const vector = await getEmb(query);
    const data = await getFullContext(vector, query);
    console.log("GOT DATA - CHUNKS:", data.chunks.length);

    const extractPrompt = buildExtractionPrompt(query, data);
    const extractResponse = await getAnswer(cfg.chatModel, [], extractPrompt);
    const extractContent = extractResponse.candidates[0].content.parts[0].text;
    console.log("AI RAW RESPONSE:", extractContent);

    // Clean up AI response
    let cleanContent = extractContent
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    cleanContent = cleanContent.replace(/^\s+|\s+$/g, "");
    console.log("CLEANED CONTENT:", cleanContent);

    const result = JSON.parse(cleanContent);
    console.log("PARSED OK");

    // Get AI answer
    let answer = result.detaily || result.strucne || "Bohužel nemám informace.";

    // Clean up ugly filenames in text
    answer = answer.replace(/\b[\w-]+\.(pdf|docx?|xlsx?|txt)\b/gi, (match) => {
      return match
        .replace(/\.(pdf|docx?|xlsx?|txt)$/i, '')
        .replace(/[_-]+/g, ' ')
        .replace(/pujcovny pomucek/gi, 'Půjčovny pomůcek')
        .replace(/uhrady zp/gi, 'Úhrady ZP')
        .replace(/^(\w)/, (m) => m.toUpperCase())
        .trim();
    });

    // Add [1] after each sentence
    let refNum = 1;
    answer = answer.replace(/([^#\n][.!?])(\s+)/g, (match, punct, space) => {
      if (refNum <= data.chunks.length) {
        return `${punct} [${refNum++}]${space}`;
      }
      return match;
    });

    // Scan answer for citations
    const citedIndices = new Set();
    const citationPattern = /\[(\d+)\]/g;
    let match;
    while ((match = citationPattern.exec(answer)) !== null) {
      citedIndices.add(parseInt(match[1]) - 1);
    }

    // Get cited chunks
    const citedChunks = Array.from(citedIndices)
      .filter(i => i < data.chunks.length)
      .map(i => data.chunks[i]);

    // Helper function to format file titles with icons
    const formatFileTitle = (url) => {
      const ext = url.split('.').pop().toLowerCase();
      let icon = '';

      if (ext === 'pdf') icon = 'PDF 📄';
      else if (ext === 'doc' || ext === 'docx') icon = 'Word 📝';
      else if (ext === 'xlsx' || ext === 'xls') icon = 'Excel 📊';
      else icon = '📎';

      let title = decodeURIComponent(url.split('/').pop());
      title = title
        .replace(/\.(pdf|docx?|xlsx?)$/i, '')
        .replace(/[_-]+/g, ' ')
        .replace(/pujcovny pomucek/gi, 'Půjčovny pomůcek')
        .replace(/uhrady zp/gi, 'Úhrady ZP')
        .replace(/odvolani/gi, 'Odvolání')
        .replace(/zadost/gi, 'Žádost')
        .replace(/zadanka/gi, 'Žádánka')
        .replace(/^(\w)/, (m) => m.toUpperCase())
        .trim();

      return `${icon} ${title}`;
    };

    const downloads = [];
    const seenDownloads = new Set();

    // Get downloads from database - SAFE version
    console.log("PROCESSING DOWNLOADS FROM", citedChunks.length, "CITED CHUNKS");
    citedChunks.forEach(chunk => {
      try {
        if (chunk && chunk.downloads && typeof chunk.downloads === 'string' && chunk.downloads.trim()) {
          console.log("CHUNK HAS DOWNLOADS:", chunk.downloads);
          const urls = chunk.downloads.split(/[\s,]+/).filter(u => u && u.trim());
          urls.forEach(url => {
            if (url && !seenDownloads.has(url) && url.match(/\.(pdf|docx?|xlsx?)$/i)) {
              seenDownloads.add(url);
              const title = formatFileTitle(url);
              downloads.push({ title, url });
              console.log("ADDED DOWNLOAD:", title);
            }
          });
        }
      } catch (e) {
        console.error("ERROR PROCESSING CHUNK DOWNLOAD:", e.message);
      }
    });
    console.log("TOTAL DOWNLOADS FOUND:", downloads.length);

    // Build sources from cited chunks
    const sources = [];
    const seenUrls = new Set();

    if (data && data.chunks) {
      citedIndices.forEach((index) => {
        if (index < data.chunks.length) {
          const chunk = data.chunks[index];
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
        }
      });
    }

    // Add downloads section
    if (downloads.length > 0) {
      answer += `\n\n---\n# 📥 Ke stažení\n\n`;
      downloads.forEach(d => {
        answer += `* [${d.title}](${d.url})\n`;
      });
    }

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
        downloads,
        metadata: { sources }
      })
    };

  } catch (err) {
    console.error("ERROR:", err.message);
    console.error("STACK:", err.stack);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        answer: "Chyba: " + err.message,
        error: err.message,
        stack: err.stack
      })
    };
  }
};
