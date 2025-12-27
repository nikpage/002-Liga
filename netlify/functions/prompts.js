function formatPrompt(query, data) {
  const chunks = (data && data.chunks) ? data.chunks : [];

  const ctx = chunks.map((c, i) =>
    `[Source ${i+1}] ${c.title}: ${c.text}`
  ).join("\n\n");

  return `You are a medical and legal advisor for Czech social benefits and healthcare.

CONTEXT:
${ctx}

USER QUESTION: ${query}

TASK:
Answer the question using the context above. Be detailed and practical.

OUTPUT MUST BE A SINGLE JSON OBJECT:
{
  "strucne": ["Key point 1", "Key point 2"],
  "detaily": "Detailed answer here",
  "vice_informaci": "Next steps or additional advice",
  "pouzite_zdroje": [1, 2]
}`;
}

module.exports = { formatPrompt };
