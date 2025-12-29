// Prompt 1: Query translation
function buildTranslationPrompt(query) {
  return `Translate this user question into proper medical/social services terminology for search.

User question: ${query}

Rules:
- Fix typos and informal language
- Use proper Czech medical terms
- Keep the meaning identical
- If already clear, return unchanged

OUTPUT JSON:
{
  "translated_query": "properly formatted question in Czech",
  "changes_made": "what you fixed, or 'none'"
}`;
}

// Prompt 2: Fact extraction
function buildExtractionPrompt(query, data) {
  const chunks = data.chunks || [];
  const ctx = chunks.map((c, i) => {
    let content = c.text;
    try {
      const parsed = JSON.parse(content);
      if (parsed.entity && parsed.municipality) {
        content = `Organizace: ${parsed.entity}, Město: ${parsed.municipality}`;
        if (parsed.features) content += `, Pomůcky: ${parsed.features.join(', ')}`;
        if (parsed.address) content += `, Adresa: ${parsed.address}`;
        if (parsed.phone) content += `, Telefon: ${parsed.phone}`;
      }
    } catch (e) {}
    return `[Source ${i+1}] ${c.title} | ${c.url}\n${content}`;
  }).join("\n\n");

  return `Extract facts from context. Liga Vozíčkářů is Brno-focused.

CONTEXT:
${ctx}

QUESTION: ${query}

OUTPUT JSON with extracted facts:
{
  "pouzite_zdroje": [{"index": 1, "title": "exact title", "url": "exact url", "duvod": "why relevant"}],
  "vytezene_fakty": {
    "dodavatele": [],
    "lékaři": [],
    "organizace": [],
    "částky": [],
    "lhůty": [],
    "telefony": [],
    "adresy": []
  }
}`;
}

// Prompt 3: Answer generation
function buildAnswerPrompt(query, extraction) {
  const facts = JSON.stringify(extraction.vytezene_fakty, null, 2);

  return `You extracted these facts: ${facts}

Now write answer to: ${query}

RULES:
- Liga Vozíčkářů is Brno-focused, prioritize Brno info
- Use simple Czech (8th grade level), formal address (vy)
- List ALL extracted facts (if lékaři has 5, list all 5)
- Numbered steps for how-to questions
- Start with Brno, then offer other cities
- Use specific names: "praktický lékař, ortoped, neurolog" not just "lékař"

OUTPUT JSON:
{
  "stručně": "One short actionable sentence. NO FLUFF.",
  "detaily": "ALL facts from above. Names, amounts, contacts. Numbered steps for how-to.",
  "širší_souvislosti": "Relevant extra info only"
}`;
}

module.exports = {
  buildTranslationPrompt,
  buildExtractionPrompt,
  buildAnswerPrompt
};
