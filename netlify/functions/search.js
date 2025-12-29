const { getEmb, getAnswer } = require("./ai-client");
const { getFullContext } = require("./database");
const { formatPrompt: buildExtractionPrompt } = require("./prompts");

const { google: cfg } = require("./config");

exports.handler = async (event) => {
  try {
    const { query } = JSON.parse(event.body);
    console.log("=== USER QUERY ===");
    console.log(query);

    // Get chunks
    const vector = await getEmb(query);
    const data = await getFullContext(vector, query);

    console.log("=== RETRIEVED CHUNKS ===");
    console.log(`Total chunks: ${data.chunks.length}`);
    data.chunks.forEach((chunk, i) => console.log(`[${i+1}] ${chunk.title}`));

    // STAGE 1: Extract facts and sources
    console.log("=== STAGE 1: EXTRACTION ===");
    const extractPrompt = buildExtractionPrompt(query, data);
    const extractResponse = await getAnswer(cfg.chatModel, [], extractPrompt);
    const extractContent = extractResponse.candidates[0].content.parts[0].text;

    let extraction;
    try {
      extraction = JSON.parse(extractContent.replace(/```json/g, "").replace(/```/g, "").trim());
      console.log("Sources:", extraction.pouzite_zdroje?.length || 0);
      console.log("Facts:", JSON.stringify(extraction.vytěžené_fakty, null, 2));
    } catch (e) {
      console.error("❌ EXTRACTION FAILED:", e.message);
      return {
        statusCode: 500,
        body: JSON.stringify({ answer: "Chyba při extrakci dat." })
      };
    }

    // STAGE 2: Generate answer
    console.log("=== STAGE 2: ANSWER ===");
    const answerPrompt = buildAnswerPrompt(query, extraction);
    const answerResponse = await getAnswer(cfg.chatModel, [], answerPrompt);
    const answerContent = answerResponse.candidates[0].content.parts[0].text;

    let finalAnswer;
    try {
      finalAnswer = JSON.parse(answerContent.replace(/```json/g, "").replace(/```/g, "").trim());
      console.log("Answer generated");
    } catch (e) {
      console.error("❌ ANSWER FAILED:", e.message);
      return {
        statusCode: 500,
        body: JSON.stringify({ answer: "Chyba při generování odpovědi." })
      };
    }

    // Build sources
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

    console.log("=== SOURCES ===");
    console.log(`Count: ${uniqueSources.length}`);

    // Format response
    const strucne = finalAnswer.stručně || "Bohužel nemám odpověď.";
    let formattedResponse = `### 💡 Stručné shrnutí\n${strucne}\n\n`;

    if (finalAnswer.detaily && finalAnswer.detaily.length > 5) {
      formattedResponse += `### 📝 Podrobnosti\n${finalAnswer.detaily}\n\n`;
      if (finalAnswer.širší_souvislosti && finalAnswer.širší_souvislosti.length > 5) {
        formattedResponse += `### 💡 Mohlo by vás zajímat\n${finalAnswer.širší_souvislosti}\n\n`;
      }
    }

    if (uniqueSources.length > 0) {
      formattedResponse += `---\n### 📄 Použité zdroje\n`;
      uniqueSources.forEach(s => formattedResponse += `- [${s.titulek}](${s.url})\n`);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ answer: formattedResponse, metadata: { sources: uniqueSources } })
    };
  } catch (err) {
    console.error("❌ ERROR:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ answer: "Chyba: " + err.message })
    };
  }
};
