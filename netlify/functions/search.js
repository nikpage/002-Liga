exports.handler = async (event) => {
  try {
    const { query } = JSON.parse(event.body);
    const vector = await getEmb(query);
    const data = await getFullContext(vector, query);

    // STAGE 1: Single-pass Extraction & Generation
    const extractPrompt = buildExtractionPrompt(query, data);
    const extractResponse = await getAnswer(cfg.chatModel, [], extractPrompt);
    const extractContent = extractResponse.candidates[0].content.parts[0].text;

    let result;
    try {
      result = JSON.parse(extractContent.replace(/```json/g, "").replace(/```/g, "").trim());
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ answer: "Chyba při zpracování dat." }) };
    }

    // Build unique sources
    const uniqueSources = [];
    const seenUrls = new Set();
    if (result.pouzite_zdroje) {
      result.pouzite_zdroje.forEach(source => {
        if (source.url && !seenUrls.has(source.url)) {
          seenUrls.add(source.url);
          uniqueSources.push({ titulek: source.title, url: source.url });
        }
      });
    }

    // Format final response using the AI's generated fields
    const strucne = result.strucne || "Bohužel nemám odpověď.";
    let formattedResponse = `### 💡 Stručné shrnutí\n${strucne}\n\n`;

    if (result.detaily && result.detaily.length > 5) {
      formattedResponse += `### 📝 Podrobnosti\n${result.detaily}\n\n`;
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
    return { statusCode: 500, body: JSON.stringify({ answer: "Chyba: " + err.message }) };
  }
};
