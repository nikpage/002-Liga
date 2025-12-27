function formatPrompt(query, data) {
  const chunks = (data && data.chunks) ? data.chunks : [];

  const ctx = chunks.map((c, i) =>
    `[Source ${i+1}] ${c.title}: ${c.text}`
  ).join("\n\n");

  return `You are a sophisticated medical and legal advisor. Your goal is to provide
insightful, comprehensive, and highly detailed guidance based on the context.

CONTEXT:
${ctx}

USER QUESTION: ${query}

TASK:
1. Synthesize a deep, analytical answer from the provided sources.
2. If the sources are detailed, provide a multi-paragraph response with practical advice.
3. If the sources are insufficient, state clearly what is missing but provide the best possible guidance from what IS there.

OUTPUT MUST BE A SINGLE JSON OBJECT:
{
  "strucne": ["Key takeaway 1", "Key takeaway 2"],
  "detaily": "Full, detailed human-level analysis goes here.",
  "vice_informaci": "Practical next steps or specific advice.",
  "pouzite_zdroje": [1, 2]
}`;
}

module.exports = { formatPrompt };
