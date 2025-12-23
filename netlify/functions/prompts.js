function formatPrompt(query, data) {
  const ctx = data.chunks.map((c, i) =>
    `[${i+1}] NÁZEV: ${c.title}\nTEXT: ${c.text}`
  ).join("\n\n");

  return `KONTEXT Z DATABÁZE:
${ctx}

OTÁZKA: ${query}

INSTRUKCE:
Odpověz POUZE na základě poskytnutého kontextu. Použij informace ze všech relevantních zdrojů.

Odpověz ve struktuře JSON:
{
  "strucne": ["klíčový fakt 1", "klíčový fakt 2", ...],
  "detaily": "podrobná odpověď na otázku",
  "vice_informaci": "souvisící informace",
  "pouzite_zdroje": [1, 3, 5]
}

FORMÁTOVÁNÍ "strucne":
- Kontakty → ukaž kompletní kontakt
- Číselné údaje → ukaž v tabulce pokud je více hodnot
- Fakta → použij odrážky
- Zaměř se pouze na odpověď na otázku, ne na obecné informace`;
}
module.exports = { formatPrompt };
