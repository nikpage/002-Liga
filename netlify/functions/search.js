const { getEmb, getAnswer } = require("./ai-client");
const { getFullContext } = require("./database");
const { formatPrompt } = require("./prompts");
const { google: cfg } = require("./config");

exports.handler = async (event) => {
  try {
    const { query } = JSON.parse(event.body);

    // Primary vector search uses the direct user query for maximum accuracy
    const vector = await getEmb(query);
    const data = await getFullContext(vector, query);

    // If no data found, attempt a secondary search using an expanded term
    if (data.chunks.length === 0) {
       const expansionPrompt = `Jsi expert na české sociální systémy. Na základě dotazu: "${query}" vygeneruj 1 odbornou vyhledávací frázi. ODPOVĚZ POUZE JAKO STRING.`;
       const expansionRes = await getAnswer(cfg.chatModel, [], expansionPrompt);
       const expandedQuery = expansionRes.candidates[0].content.parts[0].text.trim();
       const fallbackVector = await getEmb(expandedQuery);
       const fallbackData = await getFullContext(fallbackVector, query);
       Object.assign(data, fallbackData);
    }

    const prompt = formatPrompt(query, data);
    const aiResponse = await getAnswer(cfg.chatModel, [], prompt);
    const content = aiResponse.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(content.replace(/```json/g, "").replace(/```/g, "").trim());

    const uniqueSources = [];
    const seenUrls = new Set();

    data.chunks.forEach(chunk => {
      let absoluteUrl = chunk.url || "";
      if (absoluteUrl && !absoluteUrl.startsWith('http')) {
        absoluteUrl = `http://test.ligaportal.cz/${absoluteUrl.replace(/^\//, '')}`;
      }

      if (absoluteUrl && !seenUrls.has(absoluteUrl)) {
        seenUrls.add(absoluteUrl);
        const displayTitle = chunk.title.replace(/\.[^/.]+$/, "").replace(/-/g, ' ');
        uniqueSources.push({ titulek: displayTitle, url: absoluteUrl });
      }
    });

    let formattedResponse = `### 💡 Stručné shrnutí\n${parsed.strucne}\n\n`;
    if (parsed.detaily) formattedResponse += `### 🔍 Podrobnosti\n${parsed.detaily}\n\n`;
    if (parsed.sirsí_souvislosti) formattedResponse += `### 💡 Souvislosti\n${parsed.sirsí_souvislosti}\n\n`;

    if (uniqueSources.length > 0) {
      formattedResponse += `--- \n### 📄 Použité zdroje\n`;
      uniqueSources.forEach(s => formattedResponse += `- [${s.titulek}](${s.url})\n`);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ answer: formattedResponse, metadata: { sources: uniqueSources } })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ answer: "Chyba systému: " + err.message })
    };
  }
};
