// prompts.js
module.exports = {
  rewritePrompt: (query) => `Jsi expert na sociální služby a zdravotní péči v ČR.
Převeď tento dotaz na přesné vyhledávací termíny v češtině: "${query}"

Pravidla:
- Zachovej všechna podstatná slova z dotazu
- Přidej relevantní synonyma a odborné termíny
- Pokud je uvedeno město/organizace, zahrň je
- Výstup: pouze klíčová slova a fráze oddělené čárkou, max 50 slov`,

  formatPrompt: (query, data) => {
    const ctx = data.chunks.map((c, i) =>
      `[${i+1}] DOKUMENT: ${c.title}\nOBSAH: ${c.text}`
    ).join("\n\n---\n\n");

    return `Jsi expert na sociální služby, zdravotní péči a podporu osob se zdravotním postižením v ČR.

KONTEXT Z DATABÁZE:
${ctx}

DOTAZ UŽIVATELE: ${query}

KRITICKÁ PRAVIDLA:
1. Odpovídej POUZE podle poskytnutého kontextu
2. Pokud kontext obsahuje tabulky/seznamy organizací, extrahuj VŠECHNY relevantní záznamy
3. Pokud dotaz specifikuje město/region, filtruj výsledky podle lokace
4. Používej konkrétní údaje: jména organizací, adresy, telefony, částky, termíny
5. Pokud kontext neobsahuje odpověď, napiš: "V databázi nejsou informace o tomto tématu"
6. Pokud existuje více variant/možností, vypiš je VŠECHNY

FORMÁT ODPOVĚDI (JSON):
{
  "strucne": ["hlavní fakt 1", "hlavní fakt 2", "hlavní fakt 3"],
  "detaily": "Kompletní odpověď s konkrétními údaji, názvy organizací, kontakty, podmínkami. U tabulek/seznamů zahrň všechny relevantní položky.",
  "vice_informaci": "Dodatečné podmínky, varování nebo doporučení pro uživatele.",
  "pouzite_zdroje": [1, 2, 3]
}`;
  }
};
