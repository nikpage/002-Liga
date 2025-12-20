const neo4j = require("neo4j-driver");

exports.handler = async (event) => {
  const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS));
  const { question, history = [], model = "gemini-3-flash" } = JSON.parse(event.body);
  const session = driver.session();

  try {
    // 1. Get embedding
    const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: "models/embedding-001", content: { parts: [{ text: question }] } })
    });
    const embData = await embReq.json();
    const qVector = embData.embedding.values;

    // 2. Query Neo4j
    const result = await session.run(`
      CALL db.index.vector.queryNodes('chunk_vector_index', 6, $vec)
      YIELD node, score
      MATCH (node)-[:PART_OF]->(d:Document)
      OPTIONAL MATCH (v:EquipmentVariant)
      WHERE any(word IN split(toLower($q), ' ') WHERE v.variant_name CONTAINS word)
      RETURN
        collect(DISTINCT {text: node.text, src: d.human_name, url: d.url}) AS chunks,
        collect(DISTINCT {name: v.variant_name, price: v.coverage_czk_without_dph, freq: v.doba_uziti}) AS specifics
    `, { vec: qVector, q: question.toLowerCase() });

    const record = result.records[0];
    const context = [
      ...record.get("specifics").filter(v => v.name).map(v => `TABULKA: ${v.name} | Úhrada: ${v.price} Kč | Obnova: ${v.freq}`),
      ...record.get("chunks").map(c => `ZDROJ: ${c.src} (Link: ${c.url}) | TEXT: ${c.text}`)
    ].join("\n\n");

    // 3. Map conversation history
    const contents = history.map(item => ({
      role: item.role === 'user' ? 'user' : 'model',
      parts: [{ text: item.content }]
    }));

    // 4. Stricter Prompt
    const systemPrompt = `Jsi seniorní poradce Ligy vozíčkářů. Pomáháš handicapovaným lidem věcně a lidsky (úroveň 9. třídy ZŠ).

    STRUKTURA ODPOVĚDI:
    1. ZAČNI '## Stručně'. Vytvoř přehlednou Markdown tabulku (Položka | Fakt | Detail). Buď extrémně stručný.
    2. NÁSLEDUJE '## Podrobné vysvětlení'. Jdi přímo k věci, žádný balast.
    3. PENÍZE: Tisíce odděluj tečkou (10.000 Kč).
    4. ZDROJE:
       - Vypiš 3 nejdůležitější jako: [Název dokumentu](URL).
       - Ostatní zdroje dej do: '<details><summary>Všechny použité zdroje</summary>...seznam odkazů...</details>'.
    5. TLAČÍTKA: Na úplný konec napiš '///SUGGESTIONS///'.
       - Navrhni přesně 3 krátké texty pro tlačítka (každý na nový řádek).
       - Pokud to dává smysl, jedno tlačítko musí být 'Sestavit e-mail pro poradnu'.
       - Pokud jde o složitý proces, jedno tlačítko bude 'Krok za krokem: Jak postupovat'.
       - Pokud jde o peníze, jedno tlačítko bude 'Pomoci s výpočtem limitů'.

    DATA: ${context}
    OTÁZKA: ${question}`;

    contents.push({ role: "user", parts: [{ text: systemPrompt }] });

    // 5. Call Gemini
    const genReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents })
    });

    const genData = await genReq.json();
    const answer = genData.candidates[0].content.parts[0].text;

    // Split logic ensuring no pipes or combined strings
    const [mainPart, suggestionsPart] = answer.split("///SUGGESTIONS///");
    const suggestions = suggestionsPart
      ? suggestionsPart.split("\n").map(s => s.trim()).filter(s => s.length > 0).slice(0, 3)
      : [];

    return {
      statusCode: 200,
      body: JSON.stringify({
        answer: mainPart.trim(),
        suggestions: suggestions
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  } finally {
    await session.close();
    await driver.close();
  }
};
