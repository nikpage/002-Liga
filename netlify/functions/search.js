// Ensure all necessary dependencies and configurations are initialized
const cfg = {
  chatModel: "gemini-1.5-pro", // Adjust to your specific model identifier if different
};

/**
 * RESTORED: Full logic for building the extraction prompt
 * No lines removed, no rules simplified.
 */
function buildExtractionPrompt(query, data) {
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

  return `You are a world-class legal and social advisor for Liga Vozíčkářů. You must provide a human-expert level response in Czech.

DETAILED EXTRACTION RULES:
- Liga Vozíčkářů je organizace zaměřená na Brno a jeho okolí. Pokud uživatel nezadá konkrétní město, PRIORITIZUJ informace z Brna.
- When answering "how to" questions (jak získat, jak požádat, jak postupovat), ALWAYS format the answer as NUMBERED STEPS (1., 2., 3., etc.) with specific actions.
- EXTRACT CONCRETE FACTS: Names of organizations, doctor specialties, specific amounts (Kč), timeframes (days/months), contact info, addresses. NO VAGUE STATEMENTS.
- Use SIMPLE Czech (8th-9th grade) - short sentences, everyday words. Technical terms in parentheses: "poukaz (lékařský předpis)"
- Po odpovědi pro Brno VŽDY nabídni možnosti v jiných městech (Praha, Ostrava) pokud jsou dostupné.
- Be precise with numbers.
- STRICT: Use ONLY provided context. No external knowledge.

CRITICAL EXAMPLES (BAD → GOOD):

DOCTORS:
❌ "Lékař může předepsat"
✅ "Praktický lékař, ortoped nebo neurolog může předepsat"

SUPPLIERS:
❌ "Obraťte se na dodavatelskou firmu"
✅ "Obraťte se na Ortoservis s.r.o. (tel: 123456789) nebo DMA Praha s.r.o. (email: info@dma.cz)"

INSURANCE:
❌ "Pojišťovna hradí část"
✅ "Pojišťovna hradí 90% do výše 15 000 Kč"

CONTACTS:
❌ "Kontaktujte organizaci"
✅ "Kontakt: STP Brno, tel: 541 245 495, email: stpbrno@stpraha.cz"

TIMEFRAMES:
❌ "Vyřízení trvá nějakou dobu"
✅ "Vyřízení trvá 30-60 dnů od podání žádosti"

ORGANIZATIONS:
❌ "Můžete se obrátit na sociální služby"
✅ "Můžete se obrátit na Diecézní charitu Brno (Hybešova 22) nebo Centrum Kociánka (tel: 123456789)"

HOW-TO STEPS:
❌ "Nejdříve si vyžádejte poukaz a pak navštivte dodavatele"
✅ "1. Navštivte praktického lékaře a požádejte o poukaz (formulář č. 10)
2. S poukazem kontaktujte dodavatele (Ortoservis: 123456789)
3. Po vyzkoušení pošle dodavatel žádost pojišťovně
4. Schválení trvá 14-30 dnů"

MISSING DATA:
❌ If vytěžené_fakty is empty → make up generic answer
✅ If vytěžené_fakty is empty → "strucne": "Bohužel nemám konkrétní informace", "detaily": ""

CONTEXT:
${ctx}

USER QUESTION: ${query}

OUTPUT JSON - COMPLETE ALL STEPS:

STEP 1 - Interpret the query:
{
  "interpretace_dotazu": {
    "tema": "what is user asking about (pomůcka/doktor/pojišťovna/postup)",
    "konkretni_pomucka": "specific equipment name if mentioned, or 'neurceno'",
    "lokalita": "Brno | Praha | Ostrava | neurceno",
    "typ_odpovedi": "seznam | postup | kontakt | informace"
  }
}

STEP 2 - Select which chunks to use:
{
  "pouzite_chunky": [1, 3, 7],
  "vyrazene_chunky": [
    {"id": 2, "duvod": "neobsahuje kontakty"},
    {"id": 5, "duvod": "nerelevantní město"}
  ]
}

STEP 3 - Identify sources:
{
  "pouzite_zdroje": [{"index": 1, "title": "exact title from context", "url": "exact url", "duvod": "why relevant"}]
}

MANDATORY SOURCE VERIFICATION:
- pouzite_zdroje MUST ONLY include sources you actually use in your answer
- If you mention "STP Brno" in detaily → STP Brno's source MUST be in pouzite_zdroje
- If source is in pouzite_zdroje → content from that source MUST appear in detaily

STEP 4 - Extract ALL concrete facts from USED chunks only:
{
  "vytěžené_fakty": {
    "dodavatele": [],
    "lekari": [],
    "organizace": [],
    "částky": [],
    "lhůty": [],
    "telefony": [],
    "adresy": [],
    "emaily": []
  }
}

STEP 5 - Write the answer. YOU MUST COPY EVERY SINGLE ITEM from vytěžené_fakty into your answer:

{
  "strucne": "Short answer IF you have facts. If vytěžené_fakty is empty, say 'Bohužel nemám konkrétní informace'",
  "detaily": "COPY ALL ITEMS from vytěžené_fakty here as plain readable Czech text. Use numbered steps for how-to. Write as text, NOT nested JSON.",
  "širší_souvislosti": "Only relevant extra info."
}

CRITICAL VALIDATION:
- If vytěžené_fakty has ANY non-empty arrays, strucne and detaily CANNOT be empty.
- detaily must be plain Czech text, NOT nested JSON structure.
- ALL facts from vytěžené_fakty MUST appear in detaily.`;
}

exports.handler = async (event) => {
  // CORS Headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  // Handle preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    if (!event.body) throw new Error("Missing request body");
    const { query } = JSON.parse(event.body);
    if (!query) throw new Error("Missing query in request body");

    // 1. Professional Translation for Search Quality
    const transPrompt = `Translate the following user question into technical Czech medical, social, and legal jargon specifically used for vector database searches. Provide only the translated terms: ${query}`;
    const transRes = await getAnswer(cfg.chatModel, [], transPrompt);
    const techQuery = transRes.candidates[0].content.parts[0].text;

    // 2. Vector Search and Context Retrieval
    const vector = await getEmb(techQuery);
    const data = await getFullContext(vector, query);

    // 3. Extraction and Content Generation
    const extractPrompt = buildExtractionPrompt(query, data);
    const extractResponse = await getAnswer(cfg.chatModel, [], extractPrompt);
    const extractContent = extractResponse.candidates[0].content.parts[0].text;

    // JSON cleanup and parsing
    const jsonString = extractContent.replace(/```json/g, "").replace(/```/g, "").trim();
    const result = JSON.parse(jsonString);

    // 4. Formatting Final Output with Metadata
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

    const strucne = result.strucne || "Omlouvám se, ale pro tento dotaz nemám k dispozici konkrétní informace.";
    let formattedResponse = `### 💡 Stručné shrnutí\n${strucne}\n\n`;

    if (result.detaily && result.detaily.length > 5) {
      formattedResponse += `### 📝 Podrobnosti\n${result.detaily}\n\n`;
    }

    if (uniqueSources.length > 0) {
      formattedResponse += `---\n### 📄 Použité zdroje\n`;
      uniqueSources.forEach(s => {
        formattedResponse += `- [${s.titulek}](${s.url})\n`;
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        answer: formattedResponse,
        metadata: { sources: uniqueSources }
      })
    };

  } catch (err) {
    console.error("Function Error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        answer: "Omlouváme se, došlo k chybě při zpracování vašeho dotazu.",
        error: err.message
      })
    };
  }
};
