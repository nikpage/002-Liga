const { getEmb, getAnswer } = require('./ai-client');
const { getFullContext, logQA } = require('./database');
const { logQA: logQAEway } = require('./eway-crm');
const { buildPublicPrompt, buildPoradnaPrompt } = require('./prompts');
const { buildEventsNote } = require('./events');

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

exports.search = async (payload) => {
  const startTime = Date.now();
  try {
    const { query, tag } = payload;
    const isInternal = tag === 'poradna_internal';
    // Tags route the response path (prompt) and bookkeeping — they do NOT limit
    // which sources may answer. Always search every source; if a question
    // merits a mixed-source answer, give one.
    const buildPrompt = isInternal ? buildPoradnaPrompt : buildPublicPrompt;
    const vector = await getEmb(query);
    const data = await getFullContext(vector, query, null);

    const eventsNote = buildEventsNote(data.chunks, new Date());

    const extractContent = await getAnswer([], buildPrompt(query, data, eventsNote));

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
          // FILTER: Only allow PDF downloads (Point 2)
          if (item.source_url &&
              item.source_url.toLowerCase().endsWith('.pdf') &&
              !seenDownloads.has(item.source_url) &&
              usedDownloadUrls.includes(item.source_url)) {
            seenDownloads.add(item.source_url);
            downloads.push({ title: item.file_name.replace(/\.[^/.]+$/, ""), url: item.source_url });
          }
        });
      }
    });

    const sources = [];
    const seenUrls = new Set();
    citedChunks.forEach((chunk) => {
      if (chunk.source_url && !seenUrls.has(chunk.source_url)) {
        seenUrls.add(chunk.source_url);
        sources.push({
          title: (chunk.document_title || "Zdroj").replace(/\.[^/.]+$/, ""),
          url: chunk.source_url,
          contactName: chunk.contact_name || null,
          contactImageUrl: chunk.contact_image_url || null
        });
      }
    });

    // Show each cited contact's photo inline in the answer body itself (not
    // just the Zdroje list) — insert it next to the first mention of their
    // name in the generated text.
    // Dedup by the contact PHOTO (same person can be cited under slightly
    // different names, e.g. "Jana" vs "Jana Irman" — they share one photo).
    const injectedContacts = new Set();
    sources.forEach((s) => {
      if (!s.contactImageUrl || !s.contactName || injectedContacts.has(s.contactImageUrl)) return;
      const escapedName = s.contactName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const nameRx = new RegExp(escapedName);
      if (nameRx.test(answer)) {
        const photoTag = `<img src="${s.contactImageUrl}" alt="${escapeHtml(s.contactName)}" class="contact-source-photo" style="display:inline-block;vertical-align:middle;margin-right:6px;">`;
        answer = answer.replace(nameRx, `${photoTag}${s.contactName}`);
        injectedContacts.add(s.contactImageUrl);
      }
    });

    if (downloads.length > 0) {
      answer += `\n\n---\n# 📥 Ke stažení\n\n`;
      downloads.forEach(d => { answer += `* [${d.title}](${d.url})\n`; });
    }

    if (sources.length > 0) {
      answer += `\n\n---\n# 📄 Zdroje\n\n`;
      const shownContactPhotos = new Set();
      sources.forEach((s, i) => {
        if (s.contactImageUrl && !shownContactPhotos.has(s.contactImageUrl)) {
          shownContactPhotos.add(s.contactImageUrl);
          const name = escapeHtml(s.contactName || s.title);
          answer += `${i + 1}. <span class="contact-source"><img src="${s.contactImageUrl}" alt="${name}" class="contact-source-photo"> <strong>${name}</strong> — <a href="${s.url}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a></span>\n`;
        } else {
          answer += `${i + 1}. [${s.title}](${s.url})\n`;
        }
      });
    }

    // Fire-and-forget: log Q&A to database
    logQA(query, answer);
    // Fire-and-forget: log Q&A to eWay-CRM as a Journal entry. Save is driven by
    // the SOURCES that actually built the answer, not the request tag: any answer
    // that cites a poradna source is legally/grant relevant and gets the poradna
    // (eWay-saved) treatment — including mixed-source answers.
    const usedPoradnaSource = citedChunks.some(c => c.audience === 'poradna_internal');
    if (usedPoradnaSource) {
      logQAEway(query, answer);
    }

    return { answer, downloads, metadata: { sources } };
  } catch (err) {
    throw err;
  }
};
