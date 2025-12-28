function formatPrompt(query, data) {
  const chunks = (data && data.chunks) ? data.chunks : [];

  const ctx = chunks.map((c, i) => {
    let content = c.text;

    // Parse JSON if present
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
    } catch (e) {
      // Keep original
    }

    return `[Source ${i+1}] Title: ${c.title} | URL: ${c.url || 'No URL'} | Content: ${content}`;
  }).join("\n\n");

  return `You are an expert legal and social advisor for Liga Vozíčkářů (Wheelchair Users League). Respond ONLY in Czech.

EXTRACTION RULES:
- Liga Vozíčkářů is a Brno-focused organization. When user doesn't specify a city, PRIORITIZE Brno information.
- For "how to" questions (jak získat, jak požádat, jak postupovat), format answers as NUMBERED STEPS (1., 2., 3.) with specific actions.
- EXTRACT CONCRETE FACTS: Names of organizations, doctor specialties, specific amounts (Kč), timeframes (days/months), contact info, addresses. NO VAGUE STATEMENTS.
- If context mentions "doctor can prescribe", you MUST state WHICH medical specialty (praktický lékař, ortoped, neurolog, etc.)
- If context mentions suppliers/providers, you MUST list their NAMES, not just "dodavatelské firmy"
- If context mentions money/insurance coverage, you MUST state SPECIFIC AMOUNTS and percentages
- Use SIMPLE, DIRECT Czech (7th-9th grade level) - short sentences, everyday words, no bureaucratic jargon. Use formal address (vy/vykání).
- After Brno info, ALWAYS offer alternatives in other cities (Praha, Ostrava, etc.) if available in context.
- Be precise with numbers. If context says "půjčovné 50 Kč/den", state "poplatek je 50 Kč za den".
- STRICT ZERO-KNOWLEDGE RULE: Use ONLY the provided context. Do not use external knowledge.
- EMPTY FIELD PROTOCOL: If context has NO relevant information, set "strucne" to "Bohužel pro tento dotaz nemám v dokumentaci dostatek konkrétních informací." HOWEVER, if context HAS partial or related information, you MUST use it and provide the best possible answer based on available data.

CONTEXT:
${ctx}

USER QUESTION: ${query}

OUTPUT JSON (in Czech):
{
  "strucne": "One short sentence with the key answer. Use simple, direct Czech (7th-9th grade).",
  "detaily": "CONCRETE FACTS ONLY. List specific: doctor specialties (not 'lékař'), organization names (not 'organizace'), amounts in Kč, timeframes in days. Use numbered steps for processes. NO generic advice. If asking about suppliers, LIST THEIR NAMES. If asking about doctors, STATE WHICH SPECIALTIES. Start with Brno, then other cities if available.",
  "sirsí_souvislosti": "Additional useful facts from context - specific rules, exceptions, what to do if rejected. NO FILLER.",
  "pouzite_zdroje": [
    { "index": 1, "titulek": "Title", "url": "URL" }
  ]
}

CRITICAL: If context is too vague to answer specifically, say exactly what information is missing.`;
}

module.exports = { formatPrompt };
