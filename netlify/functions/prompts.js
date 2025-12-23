cat > netlify/functions/prompts.js << 'EOF'
function formatPrompt(query, data) {
  const ctx = data.chunks.map((c, i) =>
    `[${i+1}] NÁZEV: ${c.title}\nTEXT: ${c.text}`
  ).join("\n\n");

  return `KONTEXT Z DATABÁZE:
${ctx}

OTÁZKA: ${query}

KRITICKÁ PRAVIDLA - POVINNÁ:
1. Odpověz POUZE na základě poskytnutého kontextu - NIKDY nevymýšlej informace
2. Použij VŠECHNA relevantní data z kontextu - ne jen část
3. Buď KONKRÉTNÍ - uváděj jména, čísla, adresy, telefonní čísla, e-maily, částky
4. Buď PODROBNÝ - nedávej obecné odpovědi, když máš specifická data
5. Pokud kontext obsahuje kontaktní údaje, úřední postupy, nebo konkrétní čísla - VŽDY je zahrň

FORMÁT ODPOVĚDI - JSON:
{
  "strucne": ["nejdůležitější fakt 1 s konkrétními daty", "fakt 2 s čísly/kontakty", ...],
  "detaily": "Kompletní podrobná odpověď s VŠEMI relevantnými informacemi z kontextu. Zahrň konkrétní údaje, postupy, kontakty, částky. Pokud je v kontextu více organizací nebo možností, uveď VŠECHNY.",
  "vice_informaci": "Související důležité informace z kontextu, které uživatel potřebuje znát - např. podmínky, další kroky, varování, alternativy.",
  "pouzite_zdroje": [1, 3, 5]
}

PŘÍKLADY SPRÁVNÝCH ODPOVĚDÍ:
✓ "Kontaktujte Mgr. Jana Nováka na tel. 123456789 nebo email jan.novak@org.cz"
✓ "Příspěvek činí 800 Kč měsíčně pro stupeň I a 2000 Kč pro stupeň II"
✓ "Můžete se obrátit na: 1) Organizace A (tel: X), 2) Organizace B (email: Y), 3) Úřad C (adresa: Z)"

PŘÍKLADY ŠPATNÝCH ODPOVĚDÍ:
✗ "Kontaktujte příslušnou organizaci" (chybí konkrétní kontakt)
✗ "Existují různé příspěvky" (chybí konkrétní částky)
✗ "Obraťte se na odborníky" (chybí jména a kontakty)`;
}
module.exports = { formatPrompt };
EOF
