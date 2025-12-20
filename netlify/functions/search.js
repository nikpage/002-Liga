const neo4j = require("neo4j-driver");

exports.handler = async (event) => {
  const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS));

  // Set to 2.5 Flash as the stable base.
  const { question, history = [], model = "gemini-2.5-flash" } = JSON.parse(event.body);
  const session = driver.session();

  try {
    const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: "models/embedding-001", content: { parts: [{ text: question }] } })
    });
    const embData = await embReq.json();
    const qVector = embData.embedding.values;

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

    const contents = history.map(item => ({
      role: item.role === 'user' ? 'user' : 'model',
      parts: [{ text: item.content }]
    }));

    const systemPrompt = `Jsi seniorní poradce Ligy vozíčkářů. Piš věcně, srozumitelně (úroveň 9. třídy ZŠ).
    PŘÍSNÝ ZÁKAZ: Nepoužívej žádné pozdravy (Ahoj, Dobrý den) ani úvodní vatu. Začni rovnou nadpisem ## Stručně.

    STRUKTURA ODPOVĚDI:
    1. ZAČNI '## Stručně'. Vytvoř Markdown tabulku (Položka | Fakt | Detail).
    2. NÁSLEDUJE '## Podrobné vysvětlení'. Jdi přímo k věci.
    3. PENÍZE: Tisíce odděluj tečkou (např. 10.000 Kč).
    4. ZDROJE (Formátování):
       - Nejdůležitější 3 zdroje vypiš jako odrážky: * [Název dokumentu](URL)
       - Ostatní zdroje dej do:
         <details>
         <summary>Všechny použité zdroje</summary>
         \n\n* [Název dokumentu](URL)\n* [Název dokumentu](URL)
         </details>
         (Ujisti se, že před každou odrážkou v seznamu je nový řádek).

    DATA: ${context}
    OTÁZKA: ${question}`;

    contents.push({ role: "user", parts: [{ text: systemPrompt }] });

    const genReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents })
    });

    const genData = await genReq.json();
    const answer = genData.candidates[0].content.parts[0].text;

    return {
      statusCode: 200,
      body: JSON.stringify({ answer: answer.trim() })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  } finally {
    await session.close();
    await driver.close();
  }
};
