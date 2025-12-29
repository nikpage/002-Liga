const { getEmb, getAnswer } = require("./ai-client");
const { getFullContext } = require("./database");
const { buildTranslationPrompt, buildExtractionPrompt, buildAnswerPrompt } = require("./prompts");
const { google: cfg } = require("./config");

exports.handler = async (event) => {
  try {
    const { query } = JSON.parse(event.body);
    console.log("=== USER QUERY ===");
    console.log(query);

    // CALL 1: Translate query to proper terminology
    console.log("=== CALL 1: QUERY TRANSLATION ===");
    const translationPrompt = buildTranslationPrompt(query);
    const translateResponse = await getAnswer(cfg.chatModel, [], translationPrompt);
    const translateContent = translateResponse.candidates[0].content.parts[0].text;

    console.log("Raw translation response:", translateContent);

    let translation;
    try {
      translation = JSON.parse(translateContent.replace(/```json/g, "").replace(/```/g, "").trim());
      console.log("Translated query:", translation.translated_query);
      console.log("Changes made:", translation.changes_made);
    } catch (e) {
      console.warn("Translation parse failed, using original query");
      translation = { translated_query: query, changes_made: "parse failed" };
    }

    const searchQuery = translation.translated_query;

    // Get chunks using translated query
    const vector = await getEmb(searchQuery);
    const data = await getFullContext(vector, searchQuery);

    console.log("=== RETRIEVED CHUNKS ===");
    console.log(`Total chunks found: ${data.chunks.length}`);
    data.chunks.forEach((chunk, i) => {
      console.log(`[${i+1}] ${chunk.title}`);
    });

    // CALL 2: Extract facts
    console.log("=== CALL 2: FACT EXTRACTION ===");
    const extractPrompt = buildExtractionPrompt(query, data);
    const extractResponse = await getAnswer(cfg.chatModel, [], extractPrompt);
    const extractContent = extractResponse.candidates[0].content.parts[0].text;

    console.log("Raw extraction response:", extractContent.substring(0, 500));

    let extraction;
    try {
      extraction = JSON.parse(extractContent.replace(/```json/g, "").replace(/```/g, "").trim());
      console.log("Used sources:", extraction.pouzite_zdroje?.length || 0);
      console.log("Extracted facts:", JSON.stringify(extraction.vytezene_fakty, null, 2));
    } catch (e) {
      console.error("❌ EXTRACTION PARSE FAILED:", e.message);
      return {
        statusCode: 500,
        body: JSON.stringify({ answer: "Chyba při extrakci dat." })
      };
    }

    // CALL 3: Write answer
    console.log("=== CALL 3: ANSWER GENERATION ===");
    const answerPrompt = buildAnswerPrompt(query, extraction);
    const answerResponse = await getAnswer(cfg.chatModel, [], answerPrompt);
    const answerContent = answerResponse.candidates[0].content.parts[0].text;

    console.log("Raw answer response:", answerContent.substring(0, 500));

    let finalAnswer;
    try {
      finalAnswer = JSON.parse(answerContent.replace(/```json/g, "").replace(/```/g, "").trim());
    } catch (e) {
      console.error("❌ ANSWER PARSE FAILED:", e.message);
      return {
        statusCode: 500,
        body: JSON.stringify({ answer: "Chyba při formátování odpovědi." })
      };
    }

    // Validation
    console.log("=== VALIDATION ===");
    if (extraction.vytezene_fakty) {
      const detaily = finalAnswer.detaily || "";
      const missing = [];

      if (extraction.vytezene_fakty.dodavatele) {
        extraction.vytezene_fakty.dodavatele.forEach(d => {
          if (!detaily.includes(d)) missing.push(`dodavatel: ${d}`);
        });
      }

      if (extraction.vytezene_fakty.lékaři) {
        extraction.vytezene_fakty.lékaři.forEach(l => {
          if (!detaily.includes(l)) missing.push(`lékař: ${l}`);
        });
      }

      if (missing.length > 0) {
        console.warn("⚠️ VALIDATION FAILED:", missing);
      } else {
        console.log("✓ Validation passed: All facts in answer");
      }
    }

    // Build source list from ONLY used sources
    const uniqueSources = [];
    const seenUrls = new Set();

    if (extraction.pouzite_zdroje && Array.isArray(extraction.pouzite_zdroje)) {
      extraction.pouzite_zdroje.forEach(source => {
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
    const strucne = finalAnswer.stručně || "Bohužel nemám odpověď.";
    let formattedResponse = `### 💡 Stručné shrnutí\n${strucne}\n\n`;

    if (finalAnswer.detaily && finalAnswer.detaily.length > 5) {
      formattedResponse += `### 🔍 Podrobnosti\n${finalAnswer.detaily}\n\n`;
      if (finalAnswer.širší_souvislosti && finalAnswer.širší_souvislosti.length > 5) {
        formattedResponse += `### 💡 Mohlo by vás zajímat\n${finalAnswer.širší_souvislosti}\n\n`;
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
