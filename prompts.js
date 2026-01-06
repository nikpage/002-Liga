function buildExtractionPrompt(query, data) {
  const chunks = (data && data.chunks) ? data.chunks : [];
  const ctx = chunks.map((c, i) => {
    return `[Zdroj ${i}]\nNázev: ${c.document_title}\nURL: ${c.source_url || 'Bez URL'}\nSoubory ke stažení: ${c.downloads || 'Žádné'}\nObsah: ${c.content}\n`;
  }).join("\n---\n\n");

  return `You are a helpful assistant for a Czech charity helping people with disabilities navigate social services.

YOUR TASK:
Answer the user's question COMPLETELY using ONLY information from the context below. Write in simple Czech (9th grade level), using polite "Vy" form.

CONTEXT (${chunks.length} documents):
${ctx}

QUERY: ${query}

ANSWER PRINCIPLES:
- COMPLETE ANSWER: Include ALL relevant facts from context that help answer the question
- ACCURACY: Use ONLY information from the provided context - never add outside knowledge or AI data
- CLARITY: Write in simple, clear Czech that anyone can understand
- REALISTIC: If there are common edge cases or related questions people might have, mention them briefly
- FOCUS: Stay focused on answering their specific question first, then add helpful related info
- If information is missing from context, clearly state: "Tuto informaci nemáme v našich materiálech. Můžete se obrátit na Poradnu na info@ligavozic.cz"
- ALWAYS include: contacts, addresses, phone numbers, email addresses if they're in the context
- For procedures: use clear numbered steps
- PROHIBITED: Do not use inline citations like [1] or "podle zdroje"
- PROHIBITED: Do not show raw URLs in text body

BRNO CONTEXT RULE:
Liga Vozíčářů is a Brno organization. When answering:
  • If answer includes location-specific data (addresses, contacts, local services) AND user didn't specify a city: start with "Níže jsou informace zaměřené na Brno. Pro informace o jiných městech se zeptejte."
  • If question is about general laws/regulations (not location-specific): do NOT include Brno disclaimer
  • Prioritize Brno information when relevant

Be selective: Don't list 20 organizations when 3-5 most relevant ones are enough.

FORMATTING RULES (MANDATORY):

**1. SUMMARY = SHORT:**
- Max 2-3 sentences
- Answer the question directly
- No fluff

**2. EMOJI SECTIONS = H1:**
- Format: "# 💡 Text" on its own line (any emoji)
- Text starts on NEXT line
- Max 1-2 words after emoji
- Examples: "# 💡 Shrnutí", "# 📥 Ke stažení", "# 📄 Zdroje"
- MUST have blank line before and after the header

**3. OTHER HEADINGS = H2/H3:**
- Use ## for main subheadings
- Use ### for smaller subheadings
- MUST have blank line before and after each heading

**4. WRITE ONLY FACTS:**
- Only clean information
- Do not provide any citations or references in the text
- Never show raw URLs like https://... in your text

**5. HARD LINE BREAKS:**
- Every bullet point MUST be preceded and followed by double newlines
- Never combine multiple bullet points on the same line

**6. LEGAL CITATIONS:**
- When mentioning any law or regulation, include the exact law number in parentheses immediately after
- Format: "zákon o sociálních službách (č. 108/2006 Sb.)"
- Always include "č." and "Sb." in the citation

**7. PARAGRAPH CAPPING:**
- No paragraph may exceed three sentences
- Every paragraph MUST be separated by double newlines

**8. TRACK YOUR SOURCES:**
- As you write each fact, note which source number it came from
- In the JSON, include "used_sources": [array of source numbers you actually used]
- Use the numbers from [Zdroj 0], [Zdroj 1], etc.

**9. INCLUDE ALL DOWNLOADS FROM USED SOURCES:**
- In the JSON, include "used_download_urls": [array of all download URLs from sources in used_sources]
- Automatically include every download URL from any source listed in used_sources
- Use exact URLs from "Soubory ke stažení" in context

**10. RELEVANCE:**
- Answer ONLY what they ask
- Do NOT include sources section - backend handles this

Return JSON:
{
  "strucne": "1-2 sentences direct answer",
  "detaily": "# 💡 Shrnutí\nDirect answer.\n\n## Subheading\n• Item 1\n• Item 2\n• Item 3",
  "used_sources": [0, 2, 5],
  "used_download_urls": ["https://example.com/file.pdf"]
}`;
}

module.exports = { buildExtractionPrompt };
