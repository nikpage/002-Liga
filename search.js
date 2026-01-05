const { getEmb, getAnswer } = require('./ai-client');
const { getFullContext } = require('./database');
const { google: cfg } = require('./config');
const { buildExtractionPrompt } = require('./prompts');

exports.search = async (payload) => {
  try {
    const { query } = payload;
    const vector = await getEmb(query);
    const data = await getFullContext(vector, query);
    const extractResponse = await getAnswer(cfg.chatModel, [], buildExtractionPrompt(query, data));
    const extractContent = extractResponse.candidates[0].content.parts[0].text;

    let result;
    const jsonMatch = extractContent.match(/\{[\s\S]*\}/);
    result = jsonMatch ? JSON.parse(jsonMatch[0]) : { detaily: extractContent };

    let answer = result.detaily || result.strucne || "Bohužel nemám informace.";

    answer = answer.replace(/\b[\w-]+\.(pdf|docx?|xlsx?|txt)\b/gi, (match) => {
      return match.replace(/\.(pdf|docx?|xlsx?|txt)$/i, '').replace(/[_-]+/g, ' ').replace(/^(\w)/, (m) => m.toUpperCase()).trim();
    });

    const usedSourceIndices = result.used_sources || [];
    const usedDownloadUrls = result.used_download_urls || [];
    const citedChunks = usedSourceIndices.map(idx => data.chunks[idx]).filter(c => c !== undefined);

    const downloads = [];
    const seenDownloads = new Set();
    citedChunks.forEach(chunk => {
      if (chunk.downloads && Array.isArray(chunk.downloads)) {
        chunk.downloads.forEach(item => {
          if (item.source_url && !seenDownloads.has(item.source_url) && usedDownloadUrls.includes(item.source_url)) {
            seenDownloads.add(item.source_url);
            downloads.push({ title: item.file_name.replace(/\.[^/.]+$/, ""), url: item.source_url });
          }
        });
      }
    });

    const sources = [];
    const seenUrls = new Set();
    citedChunks.forEach((chunk) => {
      if (chunk.url && !seenUrls.has(chunk.url)) {
        seenUrls.add(chunk.url);
        sources.push({ title: (chunk.title || "Zdroj").replace(/\.[^/.]+$/, ""), url: chunk.url });
      }
    });

    if (downloads.length > 0) {
      answer += `\n\n---\n# 📥 Ke stažení\n\n`;
      downloads.forEach(d => { answer += `* [${d.title}](${d.url})\n`; });
    }

    if (sources.length > 0) {
      answer += `\n\n---\n# 📄 Zdroje\n\n`;
      sources.forEach((s, i) => { answer += `${i + 1}. [${s.title}](${s.url})\n`; });
    }

    return { answer, downloads, metadata: { sources } };
  } catch (err) {
    throw err;
  }
};
