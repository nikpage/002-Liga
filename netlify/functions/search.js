const { getEmb, getAnswer } = require("./ai-client");
const { getFullContext } = require("./database");
const { formatPrompt } = require("./prompts");
const { google: cfg } = require("./config");

exports.handler = async (event) => {
  try {
    const { query } = JSON.parse(event.body);

    // Use the original query directly
    const vector = await getEmb(query);
    const data = await getFullContext(vector, query);

    console.log("=== RETRIEVED CHUNKS ===");
    console.log(`Total chunks found: ${data.chunks.length}`);
    data.chunks.forEach((chunk, i) => {
      console.log(`[${i+1}] ${chunk.title}`);
    });

    const prompt = formatPrompt(query, data);
    const aiResponse = await getAnswer(cfg.chatModel, [], prompt);
    const content = aiResponse.candidates[0].content.parts[0].text;

    console.log("=== RAW AI RESPONSE ===");
    console.log(content);
    console.log("=== END RAW RESPONSE ===");

    let parsed;
    try {
      parsed = JSON.parse(content.replace(/```json/g, "").replace(/```/g, "").trim());
    } catch (parseError) {
      console.error("❌ JSON PARSE FAILED:", parseError.message);
      console.error("Raw content that failed:", content.substring(0, 500));
      // Fallback response
      parsed = {
        pouzite_zdroje: [],
        nevyuzite_zdroje: [],
        vytezene_fakty: {},
        strucne: "Omlouváme se, došlo k chybě při zpracování odpovědi.",
        detaily: null,
        sirsí_souvislosti: null
      };
    }

    console.log("=== AI EXTRACTION ===");
    console.log("Used sources:", parsed.pouzite_zdroje?.length || 0);
    console.log("Unused sources:", parsed.nevyuzite_zdroje?.length || 0);
    console.log("Extracted facts:", JSON.stringify(parsed.vytezene_fakty, null, 2));

    // Validation: check if extracted facts appear in answer
    if (parsed.vytezene_fakty) {
      const detaily = parsed.detaily || "";
      const missing = [];

      if (parsed.vytezene_fakty.dodavatele) {
        parsed.vytezene_fakty.dodavatele.forEach(d => {
          if (!detaily.includes(d)) missing.push(`dodavatel: ${d}`);
        });
      }

      if (parsed.vytezene_fakty.lekari) {
        parsed.vytezene_fakty.lekari.forEach(l => {
          if (!detaily.includes(l)) missing.push(`lékař: ${l}`);
        });
      }

      if (missing.length > 0) {
        console.warn("⚠️ VALIDATION FAILED: Extracted facts not in answer:", missing);
      } else {
        console.log("✓ Validation passed: All extracted facts appear in answer");
      }
    }

    // Build source list from ONLY pouzite_zdroje
    const uniqueSources = [];
    const seenUrls = new Set();

    if (parsed.pouzite_zdroje && Array.isArray(parsed.pouzite_zdroje)) {
      parsed.pouzite_zdroje.forEach(source => {
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
    console.log(`Sources in response: ${uniqueSources.length}`);
    uniqueSources.forEach(s => console.log(`- ${s.titulek}`));

    // Safe access to parsed fields
    const strucne = parsed.strucne || "Bohužel nemám k dispozici odpověď na tento dotaz.";
    let formattedResponse = `### 💡 Stručné shrnutí\n${strucne}\n\n`;

    const hasData = parsed.detaily && parsed.detaily.length > 5;

    if (hasData) {
      formattedResponse += `### 🔍 Podrobnosti\n${parsed.detaily}\n\n`;
      if (parsed.sirsí_souvislosti && parsed.sirsí_souvislosti.length > 5) {
        formattedResponse += `### 💡 Mohlo by vás zajímat\n${parsed.sirsí_souvislosti}\n\n`;
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
