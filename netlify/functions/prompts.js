function buildExtractionPrompt(query, data) {
  const chunks = (data && data.chunks) ? data.chunks : [];
  const ctx = chunks.map((c, i) => {
    return `[Zdroj ${i+1}]\nNázev: ${c.title}\nURL: ${c.url || 'Bez URL'}\nObsah: ${c.text}\n`;
  }).join("\n---\n\n");

  return `Jsi expert na sociální pomoc pro osoby se zdravotním postižením. Odpovídáš v češtině.

TVŮJ ÚKOL:
Odpověz na otázku uživatele pomocí informací z kontextu níže. Pokud kontext obsahuje relevantní informace, POUŽIJ JE.

KONTEXT (${chunks.length} dokumentů):
${ctx}

DOTAZ: ${query}

PRAVIDLA:
- Pokud kontext má odpověď, použij ji
- Pokud otázka je obecná ("jaké dokumenty"), shrň co je dostupné
- Pokud otázka je konkrétní ("kde vozík"), dej přesnou odpověď
- Vždy zahrň kontakty, adresy, telefony pokud jsou v kontextu
- Pro postup ("jak získat") použij číslované kroky

Vrať JSON:
{
  "strucne": "Krátká odpověď v 2-3 větách",
  "detaily": "Plná odpověď se všemi fakty z kontextu. Pokud je tam 10 organizací, vypiš všech 10. Pokud postup, tak:\n1. První krok\n2. Druhý krok",
  "pouzite_zdroje": [
    {"title": "Název dokumentu", "url": "URL"}
  ]
}`;
}

module.exports = { buildExtractionPrompt };
