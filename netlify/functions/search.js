const { getEmb, getAnswer } = require("./ai-client");
const { getFullContext } = require("./database");
const { formatPrompt } = require("./prompts");
const { google: cfg } = require("./config");

exports.handler = async (event) => {
  try {
    const { query } = JSON.parse(event.body);

    // 1. RE-QUERYING: Translates amateur query to expert terms
    const expansionPrompt = `Jsi expert na české sociální systémy.
    Na základě dotazu: "${query}" vygeneruj 3 vysoce odborné vyhledávací fráze v češtině.
    ODPOVĚZ POUZE JAKO JSON POLE.`;

    const expansionRes = await getAnswer(cfg.chatModel, [], expansionPrompt);
    let searchTerms = [query];

    try {
      const expansionContent = expansionRes.candidates[0].content.parts[0].text;
      const cleanJson = expansionContent.replace(/```json/g, "").replace(/```/g, "").trim();
      const variations = JSON.parse(cleanJson);
      if (Array.isArray(variations)) searchTerms = [...new Set([...searchTerms, ...variations])];
    } catch (e) {
      console.error("Expansion failed, fallback to original query.");
    }

    // 2. RETRIEVAL: Using the first expert variation for high-precision vector search
    const expertQuery = searchTerms[1] || query;
    const vector = await getEmb(expertQuery);
    const data = await getFullContext(vector);

    // 3. ANSWER GENERATION: Uses your existing prompts.js architecture
    const prompt = formatPrompt(query, data);
    const aiResponse = await getAnswer(cfg.chatModel, [], prompt);

    const content = aiResponse.candidates[0].content.parts[0].text;
    const cleanAiJson = content.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleanAiJson);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        answer: parsed.detaily || "Odpověď nenalezena.",
        suggestions: parsed.strucne || [],
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
      body: JSON.stringify({ answer: "Chyba: " + err.message })
    };
  }
};
