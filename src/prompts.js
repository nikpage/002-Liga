function formatPrompt(question, data) {
  const ins = data.insurance.map(t => `POJIŠŤOVNA: ${t}`).join("\n");
  const ctx = data.chunks.map(c => `ZDROJ: ${c.src} | TEXT: ${c.text}`).join("\n\n");
  const sup = data.suppliers.map(t => `DODAVATEL: ${t}`).join("\n");
  const rnt = data.rentals.map(t => `PŮJČOVNA: ${t}`).join("\n");
  
  return `!!! HIERARCHIE PRAVDY !!!\n1. POJIŠŤOVNA data jsou prioritní.\n2. Cituj zdroj [ÚHRADY ZDRAVOTNICKÝCH PROSTŘEDKŮ].\n\nPRIORITY:\n${ins}\n\nKONTEXT:\n${ctx}\n\nDODAVATELÉ:\n${sup}\n\nPŮJČOVNY:\n${rnt}\n\nOTÁZKA: ${question}\n\nOdpověz v JSON: {"summary": ["..."], "detail": "..."}`;
}
module.exports = { formatPrompt };
