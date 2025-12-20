const neo4j = require("neo4j-driver");
const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS));

exports.handler = async (event) => {
  const { question, history = [], model = "gemini-2.5-flash" } = JSON.parse(event.body);
  const session = driver.session();

  try {
    // 1. Get Embedding (Google API call)
    const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: "models/embedding-001", content: { parts: [{ text: question }] } })
    });
    const embData = await embReq.json();
    const qVector = embData.embedding.values;

    // 2. Hybrid Query (Vector search + Graph Traversal)
    const result = await session.run(`
      CALL db.index.vector.queryNodes('chunk_vector_index', 6, $vec)
      YIELD node, score
      MATCH (node)-[:PART_OF]->(d:Document)
      OPTIONAL MATCH (d)-[:MENTIONS|REGULATES]->(v:EquipmentVariant)
      RETURN
        collect(DISTINCT {text: node.text, src: d.human_name, url: d.url}) AS chunks,
        collect(DISTINCT {name: v.variant_name, price: v.coverage_czk_without_dph, freq: v.doba_uziti}) AS specifics
    `, { vec: qVector });

    const record = result.records[0];
    const context = [
      ...record.get("specifics").filter(v => v.name).map(v => `TABULKA: ${v.name} | Úhrada: ${v.price} Kč | Obnova: ${v.freq}`),
      ...record.get("chunks").map(c => `ZDROJ: ${c.src} (Link: ${c.url}) | TEXT: ${c.text}`)
    ].join("\n\n");

    const contents = history.map(item => ({
      role: item.role === 'user' ? 'user' : 'model',
      parts: [{ text: item.content }]
    }));

    // 3. FULLY RESTORED System Prompt & Formatting
    const systemPrompt = `Jsi seniorní poradce Ligy vozíčkářů. Piš věcně a lidsky.
    PŘÍSNÝ ZÁKAZ: Nepoužívej žádné pozdravy (Ahoj, Dobrý den) ani úvodní vatu typu "Ráda ti poradím". Začni přímo nadpisem ## Stručně.

    STRUKTURA ODPOVĚDI:
    1. ZAČNI '## Stručně'. Vytvoř přehlednou Markdown tabulku (Položka | Fakt | Detail).
    2. NÁSLEDUJE '## Podrobné vysvětlení'. Jdi přímo k věci.
    3. PENÍZE: Tisíce odděluj tečkou (10.000 Kč).
    4. ZDROJE:
       - Vypiš 3 nejdůležitější jako odrážky: * [Název dokumentu](URL)
       - Ostatní zdroje dej do tohoto PŘESNÉHO formátu:
         <details>
         <summary>Všechny použité zdroje</summary>

         * [Název dokumentu](URL)
         * [Název dokumentu](URL)
         </details>

    DATA: ${context}
    OTÁZKA: ${question}`;

    contents.push({ role: "user", parts: [{ text: systemPrompt }] });

    // 4. Call Gemini 2.5 Flash
    const genReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents })
    });

    const genData = await genReq.json();
    const answer = genData.candidates[0].content.parts[0].text;

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: answer.trim() })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  } finally {
    await session.close();
  }
};
