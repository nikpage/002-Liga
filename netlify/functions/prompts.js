function formatPrompt(query, data) {
  const chunks = (data && data.chunks) ? data.chunks : [];

  const ctx = chunks.map((c, i) => {
    let content = c.text;

    // Try to parse JSON content and make it human-readable
    try {
      const parsed = JSON.parse(content);
      if (parsed.entity && parsed.municipality) {
        // It's structured data about rental organizations
        let readable = `Organizace: ${parsed.entity}, Město: ${parsed.municipality}`;

        if (parsed.features && Array.isArray(parsed.features)) {
          readable += `, Dostupné pomůcky: ${parsed.features.join(', ')}`;
        }

        if (parsed.address) readable += `, Adresa: ${parsed.address}`;
        if (parsed.phone) readable += `, Telefon: ${parsed.phone}`;
        if (parsed.email) readable += `, Email: ${parsed.email}`;
        if (parsed.note) readable += `, Poznámka: ${parsed.note}`;

        content = readable;
      }
    } catch (e) {
      // Not JSON or parsing failed, keep original text
    }

    return `[Zdroj ${i+1}] ${c.title}\n${content}`;
  }).join("\n\n");

  return `Jsi expertní poradce pro Ligu Vozíčkářů. Odpovídáš POUZE v češtině.

PRAVIDLA:
- Používej POUZE informace z kontextu níže
- Pokud se ptají na konkrétní město, vyjmenuj VŠECHNY organizace v tom městě
- Uveď všechny dostupné pomůcky, adresy, telefony
- Pokud informace chybí, řekni přesně co chybí
- Pokud kontext neobsahuje odpověď, nastav "strucne" na "Bohužel pro tento dotaz nemám informace v databázi."

KONTEXT:
${ctx}

DOTAZ: ${query}

ODPOVĚZ VE FORMÁTU JSON:
{
  "strucne": "Jedna věta shrnutí v češtině",
  "detaily": "Detailní odpověď se všemi kontakty, adresami, pomůckami. Pokud není co uvést, null.",
  "sirsí_souvislosti": "Další užitečné informace z kontextu. Pokud nejsou, null."
}`;
}

module.exports = { formatPrompt };
