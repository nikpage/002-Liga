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
      if (Array.isArray(variations)) {
        searchTerms = [...new Set([...searchTerms, ...variations])];
      }
    } catch (e) {
      console.error("Expansion failed, fallback to original query.");
    }

    // 2. RETRIEVAL: Using the first expert variation for precision
    const expertQuery = searchTerms[1] || query;
    const vector = await getEmb(expertQuery);
    const data = await getFullContext(vector);

    // 3. ANSWER GENERATION
    const prompt = formatPrompt(query, data);
    const aiResponse = await getAnswer(cfg.chatModel, [], prompt);

    const content = aiResponse.candidates[0].content.parts[0].text;
    const cleanAiJson = content.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleanAiJson);

    // 4. FORMATTING THE FINAL OUTPUT
    // Succinct Summary
    let formattedResponse = `### 💡 Stručné shrnutí\n${parsed.strucne}\n\n`;

    // Detailed Section (Conditional)
    if (parsed.detaily && parsed.detaily.trim() !== "" && parsed.detaily !== null) {
      formattedResponse += `### 🔍 Podrobnosti\n${parsed.detaily}\n\n`;
    }

    // Broader Context
    if (parsed.sirsí_souvislosti && parsed.sirsí_souvislosti.trim() !== "") {
      formattedResponse += `### 💡 Mohlo by vás zajímat\n${parsed.sirsí_souvislosti}\n\n`;
    }

    // Links to Documents
    if (parsed.pouzite_zdroje && parsed.pouzite_zdroje.length > 0) {
      formattedResponse += `--- \n### 📄 Použité zdroje\n`;
      parsed.pouzite_zdroje.forEach(source => {
        formattedResponse += `- [${source.titulek}](${source.url})\n`;
      });
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        answer: formattedResponse,
        suggestions: [],
        metadata: {
            expert_query: expertQuery,
            sources: parsed.pouzite_zdroje || []
        }
      })
    };
  } catch (err) {
    console.error("Search Error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: "Chyba při zpracování požadavku: " + err.message })
    };
  }
};
