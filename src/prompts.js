function formatPrompt(question, data) {
  const ins = data.insurance.map(t => `INSURANCE: ${t}`).join("\n");
  const ctx = data.chunks.map(c => `ZDROJ: ${c.src} | TEXT: ${c.text}`).join("\n\n");
  return `!!! HIERARCHIE PRAVDY !!!\n1. INSURANCE data prioritní.\n\nPRIORITY:\n${ins}\n\nKONTEXT:\n${ctx}\n\nOTÁZKA: ${question}\n\nOdpověz v JSON: {"summary": ["..."], "detail": "..."}`;
}
module.exports = { formatPrompt };
