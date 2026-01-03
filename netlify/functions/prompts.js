function buildExtractionPrompt(query, data) {
  const chunks = (data && data.chunks) ? data.chunks : [];
  const ctx = chunks.map((c, i) => {
    return `[Zdroj ${i+1}]\nNázev: ${c.title}\nURL: ${c.url || 'Bez URL'}\nObsah: ${c.text}\n`;
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

RULES FOR SHARING SOURCES:

**MANDATORY URL FORMAT: Every downloadable file MUST use this exact format:**
• [Title text here](http://complete.url.here)
  Description here.

**Example of CORRECT format:**
• [Vzor odvolání](http://test.ligaportal.cz/wp-content/uploads/2015/01/Vzor)
  Vzorový dokument pro podání odvolání.

**Example of WRONG format (NEVER do this):**
• Vzor odvolání
  Vzorový dokument...

**FOR DOWNLOADABLE FILES:**
Format: • [Title](URL)
         Description.

Never show URLs as visible text.

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
- No links, no numbers, no references
- Only clean information
- Backend automatically adds references

**5. RELEVANCE:**
- Answer ONLY what they ask

Return JSON:
{
  "strucne": "1-2 sentences direct answer",
  "detaily": "# 💡 Shrnutí\nDirect answer.\n\n## Subheading\n• Item 1\n• Item 2"
}`;
}

module.exports = { buildExtractionPrompt };
