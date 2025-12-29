exports.handler = async (event) => {
  try {
    const { query } = JSON.parse(event.body);

    // 1. Translation to technical jargon for better search
    const transPrompt = `Translate to technical Czech medical/social jargon for vector search: ${query}`;
    const transRes = await getAnswer(cfg.chatModel, [], transPrompt);
    const techQuery = transRes.candidates[0].content.parts[0].text;

    const vector = await getEmb(techQuery);
    const data = await getFullContext(vector, query);

    // 2. Data Preparation using your exact logic
    const chunks = (data && data.chunks) ? data.chunks : [];
    const ctx = chunks.map((c, i) => {
      let content = c.text;
      try {
        const parsed = JSON.parse(content);
        if (parsed.entity && parsed.municipality) {
          let readable = `Organizace: ${parsed.entity}, Město: ${parsed.municipality}`;
          if (parsed.features && Array.isArray(parsed.features)) {
            readable += `, Pomůcky: ${parsed.features.join(', ')}`;
          }
          if (parsed.address) readable += `, Adresa: ${parsed.address}`;
          if (parsed.phone) readable += `, Telefon: ${parsed.phone}`;
          if (parsed.email) readable += `, Email: ${parsed.email}`;
          if (parsed.note) readable += `, Poznámka: ${parsed.note}`;
          content = readable;
        }
      } catch (e) {}
      return `[Source ${i+1}] Title: ${c.title} | URL: ${c.url || 'No URL'} | Content: ${content}`;
    }).join("\n\n");

    // 3. The Full Expert Prompt (Exact logic restored)
    const extractPrompt = `You are a world-class legal and social advisor for Liga Vozíčkářů. You must provide a human-expert level response in Czech.

DETAILED EXTRACTION RULES:
- Liga Vozíčkářů je organizace zaměřená na Brno a jeho okolí. Pokud uživatel nezadá konkrétní město, PRIORITIZUJ informace z Brna.
- When answering "how to" questions (jak získat, jak požádat, jak postupovat), ALWAYS format the answer as NUMBERED STEPS (1., 2., 3., etc.) with specific actions.
- EXTRACT CONCRETE FACTS: Names of organizations, doctor specialties, specific amounts (Kč), timeframes (days/months), contact info, addresses. NO VAGUE STATEMENTS.
- Use SIMPLE Czech (8th-9th grade) - short sentences, everyday words. Technical terms in parentheses: "poukaz (lékařský předpis)"
- Po odpovědi pro Brno VŽDY nabídni možnosti v jiných městech (Praha, Ostrava) pokud jsou dostupné.
- Be precise with numbers.
- STRICT: Use ONLY provided context. No external knowledge.

CONTEXT:
${ctx}

USER QUESTION: ${query}

OUTPUT JSON - COMPLETE ALL STEPS:
{
  "pouzite_zdroje": [{"title": "exact title", "url": "url"}],
  "vytěžené_fakty": {"dodavatele": [], "lekari": [], "telefony": [], "adresy": [], "emaily": []},
  "strucne": "Short summary",
  "detaily": "Full Czech text. COPY ALL ITEMS from vytěžené_fakty here."
}
ALL facts from vytěžené_fakty MUST appear in detaily.`;

    const extractResponse = await getAnswer(cfg.chatModel, [], extractPrompt);
    const extractContent = extractResponse.candidates[0].content.parts[0].text;
    const result = JSON.parse(extractContent.replace(/```json/g, "").replace(/```/g, "").trim());

    // 4. Formatting response as originally intended
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
