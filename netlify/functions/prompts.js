module.exports = {
  // PHASE 1: Precise Expert Translation
  rewritePrompt: (query) => `Jsi expert na sociální služby.
Převeď dotaz: "${query}" na 3-5 nejpřesnějších odborných termínů v češtině.
POVINNÁ PRAVIDLA:
1. Musíš zachovat původní podstatná jména (např. "vozík").
2. Přidej konkrétní technický název (např. "mechanický vozík", "půjčovna kompenzačních pomůcek").
3. ŽÁDNÉ OBECNÉ KATEGORIE.
4. Výstupem budou pouze tato slova oddělená čárkou.`,

  // PHASE 2: Expert Answer
  formatPrompt: (query, data) => {
    const ctx = data.chunks.map((c, i) => `[${i+1}] NÁZEV: ${c.title}\nTEXT: ${c.text}`).join("\n\n");
    return `KONTEXT Z DATABÁZE:
${ctx}

OTÁZKA: ${query}

KRITICKÁ PRAVIDLA:
1. Odpověz POUZE na základě poskytnutého kontextu. Pokud v něm odpověď není, napiš: "V databázi nejsou informace o tomto tématu."
2. Používej konkrétní jména, adresy, telefony a částky.
3. Pokud kontext obsahuje více možností, vypiš je všechny.

FORMÁT ODPOVĚDI - JSON:
{
  "strucne": ["fakt 1", "fakt 2"],
  "detaily": "Podrobná odpověď...",
  "vice_informaci": "Podmínky/Varování...",
  "pouzite_zdroje": [1, 2]
}`;
  }
};
