const { getEmb, getAnswer } = require("./ai-client");
const { getFullContext } = require("./database");
const { formatPrompt } = require("./prompts");
const { google: cfg } = require("./config");

exports.handler = async (event) => {
  try {
    const { query } = JSON.parse(event.body);

    const expansionPrompt = `Jsi expert na české sociální systémy. Na základě dotazu: "${query}" vygeneruj 3 vysoce odborné vyhledávací fráze v češtině. ODPOVĚZ POUZE JAKO JSON POLE.`;
    const expansionRes = await getAnswer(cfg.chatModel, [], expansionPrompt);
    let searchTerms = [query];

    try {
      const expansionContent = expansionRes.candidates[0].content.parts[0].text;
      const cleanJson = expansionContent.replace(/```json/g, "").replace(/```/g, "").trim();
      const variations = JSON.parse(cleanJson);
      if (Array.isArray(variations)) searchTerms = [...new Set([...searchTerms, ...variations])];
    } catch (e) {
      console.error("Expansion failed");
    }

    const expertQuery = searchTerms[1] || query;
    const vector = await getEmb(expertQuery);
    // Fixed to include query as required by database.js
    const data = await getFullContext(vector, query);

    const prompt = formatPrompt(query, data);
    const aiResponse = await getAnswer(cfg.chatModel, [], prompt);
    const content = aiResponse.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(content.replace(/```json/g, "").replace(/```/g, "").trim());

    const uniqueSources = [];
    const seenUrls = new Set();

    data.chunks.forEach(chunk => {
      // Uses the real link from the database
      let absoluteUrl = chunk.url;

      if (!absoluteUrl.startsWith('http')) {
        absoluteUrl = `http://test.ligaportal.cz/${absoluteUrl.replace(/^\//, '')}`;
      }

      if (!seenUrls.has(absoluteUrl)) {
        seenUrls.add(absoluteUrl);

        const displayTitle = chunk.title
          .replace(/\.(md|json|doc|docx|pdf)$/i, '')
          .replace(/-/g, ' ')
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');

        uniqueSources.push({ titulek: displayTitle, url: absoluteUrl });
      }
    });

    let formattedResponse = `### 💡 Stručné shrnutí\n${parsed.strucne}\n\n`;

    const hasData = parsed.detaily && parsed.detaily.length > 5;

    if (hasData) {
      formattedResponse += `### 🔍 Podrobnosti\n${parsed.detaily}\n\n`;
      if (parsed.sirsí_souvislosti && parsed.sirsí_souvislosti.length > 5) {
        formattedResponse += `### 💡 Mohlo by vás zajímat\n${parsed.sirsí_souvislosti}\n\n`;
      }
    }

    if (uniqueSources.length > 0) {
      formattedResponse += `--- \n### 📄 Použité zdroje\n`;
      // Link text is the title of the document, linked to the real document URL
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
      body: JSON.stringify({ answer: "Chyba: " + err.message })
    };
  }
};
