function formatPrompt(query, data) {
  const chunks = (data && data.chunks) ? data.chunks : [];
  const ctx = chunks.map((c, i) =>
    `[Source ${i+1}] ${c.title || 'No Title'}: ${c.text || ''}`
  ).join("\n\n");

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

// THIS MUST BE HERE
module.exports = { formatPrompt };
