function formatPrompt(query, data) {
  // Simplifies the context so the AI doesn't get confused by metadata
  const ctx = data.chunks.map((c, i) =>
    `[Zdroj ${i+1}] ${c.title}: ${c.text}`
  ).join("\n\n");

  return `Jsi asistent, který odpovídá výhradně podle přiložených dokumentů.

KONTEXT:
${ctx}

OTÁZKA: ${query}

PRAVIDLA:
1. Odpověz na základě kontextu. Pokud tam info je, MUSÍŠ ho použít.
2. Buď konkrétní - vypiš jména, telefony, částky a adresy.
3. Cituj zdroje pomocí [Zdroj X].
4. Pokud v datech odpověď není, napiš "Informace nejsou v databázi".
5. Odpověz VŽDY ve formátu JSON.

FORMÁT ODPOVĚDI (JSON):
{
  "strucne": ["fakt 1", "fakt 2"],
  "detaily": "Podrobná odpověď s citacemi [Zdroj X].",
  "vice_informaci": "Další kroky nebo varování.",
  "pouzite_zdroje": [1, 2]
}`;
}

module.exports = { formatPrompt };
