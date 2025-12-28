const { getEmb, getAnswer } = require("./ai-client");
const { getFullContext } = require("./database");
const { formatPrompt } = require("./prompts");
const { google: cfg } = require("./config");

exports.handler = async (event) => {
  try {
    const { query } = JSON.parse(event.body);

    // 1. RE-QUERYING: Translates amateur query to expert terms
    const expansionPrompt = `Jsi expert na české sociální systémy. Na základě dotazu: "${query}" vygeneruj 3 vysoce odborné vyhledávací fráze v češtině. ODPOVĚZ POUZE JAKO JSON POLE.`;
    const expansionRes = await getAnswer(cfg.chatModel, [], expansionPrompt);
    let searchTerms = [query];

    try {
      const expansionContent = expansionRes.candidates[0].content.parts[0].text;
      const cleanJson = expansionContent.replace(/```json/g, "").replace(/```/g, "").trim();
      const variations = JSON.parse(cleanJson);
      if (Array.isArray(variations)) searchTerms = [...new Set([...searchTerms, ...variations])];
    } catch (e) { console.error("Expansion failed"); }

    // 2. RETRIEVAL: Pulling precise 1000-char segments
    const expertQuery = searchTerms[1] || query;
    const vector = await getEmb(expertQuery);
    const data = await getFullContext(vector);

    // 3. ANSWER GENERATION
    const prompt = formatPrompt(query, data);
    const aiResponse = await getAnswer(cfg.chatModel, [], prompt);
    const content = aiResponse.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(content.replace(/```json/g, "").replace(/```/g, "").trim());

    // 4. DEDUPLICATE AND FORMAT SOURCES
    const uniqueSources = [];
    const seenUrls = new Set();

    // Map database chunks to formatted sources
    data.chunks.forEach(chunk => {
      if (!seenUrls.has(chunk.url)) {
        seenUrls.add(chunk.url);
        // Capitalize titles correctly (replaces hyphens with spaces)
        const displayTitle = chunk.title.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        uniqueSources.push({ titulek: displayTitle, url: chunk.url });
      }
    });

    // 5. FINAL UI ASSEMBLY
    let formattedResponse = `### 💡 Stručné shrnutí\n${parsed.strucne}\n\n`;
    if (parsed.detaily) formattedResponse += `### 🔍 Podrobnosti\n${parsed.detaily}\n\n`;
    if (parsed.sirsí_souvislosti) formattedResponse += `### 💡 Mohlo by vás zajímat\n${parsed.sirsí_souvislosti}\n\n`;

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
    return { statusCode: 500, body: JSON.stringify({ answer: "Chyba: " + err.message }) };
  }
};
