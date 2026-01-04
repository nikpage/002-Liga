function buildExtractionPrompt(query, data) {
  const chunks = (data && data.chunks) ? data.chunks : [];
  const ctx = chunks.map((c, i) => {
    return `[Zdroj ${i}]\nNázev: ${c.title}\nURL: ${c.url || 'Bez URL'}\nSoubory ke stažení: ${c.downloads || 'Žádné'}\nObsah: ${c.text}\n`;
  }).join("\n---\n\n");

  return `You are an expert on social assistance for people with disabilities. You answer in Czech.


YOUR TASK:
Answer the user's question using information from the context below. If context contains relevant information, USE IT.

CONTEXT (${chunks.length} documents):
${ctx}

QUERY: ${query}

CONTENT RULES:
- If context has the answer, use it
- If question is general ("what documents"), summarize what's available
- If question is specific ("where wheelchair"), give precise answer
- Always include contacts, addresses, phones if in context
- For procedures ("how to get") use numbered steps
- BRNO FIRST: Liga Vozíčkářů is a Brno organization. If user doesn't specify another city:
  • PRIORITIZE information from Brno
  • In response ALWAYS state: "Níže jsou informace zaměřené na Brno. Pro informace o jiných městech se zeptejte."
  • Mention other cities only when it makes sense or when user explicitly wants broader overview
- Be selective: Don't list all 20 organizations if 3-5 relevant ones suffice

DOWNLOADABLE FILES:
- NEVER create a "Zdroje" or "Ke stažení" section.
- DO NOT use any source tags like <source> or [1].

FORMATTING RULES (ABSOLUTELY MANDATORY):

**1. SUMMARY = SHORT:**
- Max 2-3 sentences
- Answer the question directly
- No fluff

**2. EMOJI SECTIONS = H1:**
- Format: "# 💡 Text" on its own line (any emoji)
- Text starts on NEXT line
- Max 1-2 words after emoji
- Examples: "# 💡 Shrnutí", "# 📥 Ke stažení", "# 📄 Zdroje"

**3. OTHER HEADINGS = H2/H3:**
- Use ## for main subheadings
- Use ### for smaller subheadings

**4. WRITE ONLY FACTS:**
- Only clean information
- Do not provide any citations or references in the text
- Never show raw URLs like https://... in your text

**5. TRACK YOUR SOURCES:**
- In the JSON, include "used_sources": [array of source numbers you actually used]
- Only list sources you referenced to write the answer
- Use the numbers from [Zdroj 0], [Zdroj 1], etc.

**6. RELEVANCE:**
- Answer ONLY what they ask
- Do NOT include sources section - backend handles this

Return JSON:
{
  "strucne": "1-2 sentences direct answer",
  "detaily": "# 💡 Shrnutí\nDirect answer.\n\n## Subheading\n• Item 1\n• Item 2\n• Item 3",
  "used_sources": [0, 2, 5]
}`;
}

module.exports = { buildExtractionPrompt };
