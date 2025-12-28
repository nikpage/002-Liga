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

    const prompt = formatPrompt(query, data);
    const aiResponse = await getAnswer(cfg.chatModel, [], prompt);
    const content = aiResponse.candidates[0].content.parts[0].text;

    let parsed;
    try {
      parsed = JSON.parse(content.replace(/```json/g, "").replace(/```/g, "").trim());
    } catch (parseError) {
      console.error("JSON parse failed:", parseError);
      console.error("Raw content:", content);
      // Fallback response
      parsed = {
        strucne: "Omlouváme se, došlo k chybě při zpracování odpovědi.",
        detaily: null,
        sirsí_souvislosti: null
      };
    }

    const uniqueSources = [];
    const seenUrls = new Set();

    data.chunks.forEach(chunk => {
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
    console.error("Handler error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ answer: "Chyba: " + err.message })
    };
  }
};
