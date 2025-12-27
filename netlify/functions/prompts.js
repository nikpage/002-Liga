function formatPrompt(query, data) {
  // 1. SAFEGUARD: If data is missing, don't crash, provide empty context
  const chunks = (data && data.chunks) ? data.chunks : [];

  const ctx = chunks.map((c, i) =>
    `[Source ${i+1}] ${c.title || 'No Title'}: ${c.text || ''}`
  ).join("\n\n");

  // 2. THE RIGID PROMPT (Forces the AI into a corner)
  return `Answer the question based ONLY on the context.
Output MUST be a single JSON object. No markdown, no "json" tags, no text before or after.

CONTEXT:
${ctx}

QUESTION: ${query}

JSON SCHEMA:
{
  "strucne": ["fact"],
  "detaily": "full answer",
  "vice_informaci": "extra info",
  "pouzite_zdroje": [1]
}`;
}
