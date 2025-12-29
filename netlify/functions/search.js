const { getEmb, getAnswer } = require("./ai-client");
const { getFullContext } = require("./database");
const { formatPrompt } = require("./prompts");
const { google: cfg } = require("./config");

exports.handler = async (event) => {
  try {
    const { query } = JSON.parse(event.body);
    console.log("=== USER QUERY ===");
    console.log(query);

    // Get embedding and retrieve chunks
    const vector = await getEmb(query);
    const data = await getFullContext(vector, query);

    console.log("=== RETRIEVED CHUNKS ===");
    console.log(`Total chunks found: ${data.chunks.length}`);
    data.chunks.forEach((chunk, i) => {
      console.log(`[${i+1}] ${chunk.title}`);
    });

    // Single AI call with complete prompt
    console.log("=== AI CALL: COMPLETE ANALYSIS ===");
    const prompt = formatPrompt(query, data);
    const response = await getAnswer(cfg.chatModel, [], prompt);
    const rawContent = response.candidates[0].content.parts[0].text;

    console.log("Raw AI response:", rawContent.substring(0, 500));

    // Parse JSON response
    let result;
    try {
      result = JSON.parse(rawContent.replace(/```json/g, "").replace(/```/g, "").trim());
    } catch (e) {
      console.error("❌ JSON PARSE FAILED:", e.message);
      return {
        statusCode: 500,
        body: JSON.stringify({ answer: "Chyba při zpracování odpovědi." })
      };
    }

    // Log intermediate steps
    console.log("=== INTERPRETACE DOTAZU ===");
    console.log(JSON.stringify(result.interpretace_dotazu, null, 2));

    console.log("=== POUŽITÉ CHUNKY ===");
    console.log("Použité:", result.pouzite_chunky);
    console.log("Vyřazené:", result.vyrazene_chunky);

    console.log("=== POUŽITÉ ZDROJE ===");
    console.log(`Počet zdrojů: ${result.pouzite_zdroje?.length || 0}`);
    result.pouzite_zdroje?.forEach(s => console.log(`- [${s.index}] ${s.title}`));

    console.log("=== VYTĚŽENÉ FAKTY ===");
    console.log(JSON.stringify(result.vytěžené_fakty, null, 2));

    // Validation
    console.log("=== VALIDATION ===");
    const fakty = result.vytěžené_fakty;
    const detaily = result.detaily || "";
    const missing = [];

    // Check all fact types are included in detaily
    if (fakty.dodavatele && fakty.dodavatele.length > 0) {
      fakty.dodavatele.forEach(d => {
        if (!detaily.includes(d)) missing.push(`dodavatel: ${d}`);
      });
    }

    if (fakty.lekari && fakty.lekari.length > 0) {
      fakty.lekari.forEach(l => {
        if (!detaily.includes(l)) missing.push(`lékař: ${l}`);
      });
    }

    if (fakty.organizace && fakty.organizace.length > 0) {
      fakty.organizace.forEach(o => {
        if (!detaily.includes(o)) missing.push(`organizace: ${o}`);
      });
    }

    if (fakty.telefony && fakty.telefony.length > 0) {
      fakty.telefony.forEach(t => {
        if (!detaily.includes(t)) missing.push(`telefon: ${t}`);
      });
    }

    if (fakty.emaily && fakty.emaily.length > 0) {
      fakty.emaily.forEach(e => {
        if (!detaily.includes(e)) missing.push(`email: ${e}`);
      });
    }

    if (fakty.adresy && fakty.adresy.length > 0) {
      fakty.adresy.forEach(a => {
        if (!detaily.includes(a)) missing.push(`adresa: ${a}`);
      });
    }

    if (missing.length > 0) {
      console.warn("⚠️ VALIDATION FAILED - Missing facts:", missing);
    } else {
      console.log("✓ Validation passed: All facts in answer");
    }

    // Build source list from ONLY used sources
    const uniqueSources = [];
    const seenUrls = new Set();

    if (result.pouzite_zdroje && Array.isArray(result.pouzite_zdroje)) {
      result.pouzite_zdroje.forEach(source => {
        if (source.url && !seenUrls.has(source.url)) {
          seenUrls.add(source.url);
          const displayTitle = source.title
            .replace(/\.(md|json|doc|docx|pdf)$/i, '')
            .replace(/-/g, ' ')
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
          uniqueSources.push({ titulek: displayTitle, url: source.url });
        }
      });
    }

    console.log("=== FINAL SOURCES ===");
    console.log(`Sources: ${uniqueSources.length}`);
    uniqueSources.forEach(s => console.log(`- ${s.titulek}`));

    // Format response
    const strucne = result.stručně || "Bohužel nemám odpověď.";
    let formattedResponse = `### 💡 Stručné shrnutí\n${strucne}\n\n`;

    if (result.detaily && result.detaily.length > 5) {
      formattedResponse += `### 📝 Podrobnosti\n${result.detaily}\n\n`;
      if (result.širší_souvislosti && result.širší_souvislosti.length > 5) {
        formattedResponse += `### 💡 Mohlo by vás zajímat\n${result.širší_souvislosti}\n\n`;
      }
    }

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
    console.error("❌ HANDLER ERROR:", err);
    console.error("Stack:", err.stack);
    return {
      statusCode: 500,
      body: JSON.stringify({ answer: "Chyba: " + err.message })
    };
  }
};
