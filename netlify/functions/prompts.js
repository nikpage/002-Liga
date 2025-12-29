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

PRAVIDLA OBSAHU:
- Pokud kontext má odpověď, použij ji
- Pokud otázka je obecná ("jaké dokumenty"), shrň co je dostupné
- Pokud otázka je konkrétní ("kde vozík"), dej přesnou odpověď
- Vždy zahrň kontakty, adresy, telefony pokud jsou v kontextu
- Pro postup ("jak získat") použij číslované kroky
- BRNO FIRST: Liga Vozíčkářů je brněnská organizace. Pokud uživatel nespecifikuje jiné město, PRIORITIZUJ informace z Brna. Ostatní města zmiň jen když má smysl nebo když uživatel výslovně chce širší přehled.
- Buď selektivní: Neuváděj všech 20 organizací pokud 3-5 relevantních stačí

PRAVIDLA FORMÁTOVÁNÍ (DŮLEŽITÉ):
- Piš pro čtenáře s úrovní 9. třídy ZŠ - jednoduše, jasně
- ŽÁDNÉ ZDĚNÉ TEXTY: Rozbij dlouhé odstavce na kratší kusy (max 3-4 řádky)
- Nadpisy na vlastní řádek, text pod nimi
- Používej odrážky (•) pro seznamy
- Kontakty formátuj přehledně, např:
  • Organizace XYZ
    Tel: 123 456 789
    Email: info@xyz.cz
    Adresa: Ulice 1, Brno

- Mezi sekce dej prázdný řádek pro čitelnost
- Pro postupy používej číslování (1., 2., 3.)

Vrať JSON:
{
  "strucne": "Krátká odpověď v 2-3 větách",
  "detaily": "Plná odpověď s dobrým formátováním:\n\n**Nadpis sekce**\nText text text.\n\nDalší odstavec.\n\n• Odrážka 1\n• Odrážka 2\n\nKontakty:\n• Org 1 - tel, email\n• Org 2 - tel, email",
  "pouzite_zdroje": [
    {"title": "Název dokumentu", "url": "URL"}
  ]
}`;
}

module.exports = { buildExtractionPrompt };
