const neo4j = require("neo4j-driver");
const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS));

exports.handler = async (event) => {
  const { question, history = [], model = "gemini-2.5-flash" } = JSON.parse(event.body);
  const session = driver.session();

  try {
    // 1. Get Embedding (Google API)
    const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: "models/embedding-001", content: { parts: [{ text: question }] } })
    });
    const embData = await embReq.json();
    const qVector = embData.embedding.values;

    // 2. Hybrid Search (Using your actual relationship labels: INCLUDES, HAS_VARIANT, APPLIES_TO)
    const result = await session.run(`
      CALL db.index.vector.queryNodes('chunk_vector_index', 6, $vec)
      YIELD node, score
      MATCH (node)-[:PART_OF]->(d:Document)
      OPTIONAL MATCH (d)-[:INCLUDES|HAS_VARIANT|APPLIES_TO]->(v:EquipmentVariant)
      RETURN
        collect(DISTINCT {text: node.text, src: d.human_name, url: d.url}) AS chunks,
        collect(DISTINCT {name: v.variant_name, price: v.coverage_czk_without_dph, freq: v.doba_uziti}) AS graphData
    `, { vec: qVector });

    const rec = result.records[0];
    const context = [
      ...rec.get("graphData").filter(v => v.name).map(v => `DATA: ${v.name} | Úhrada: ${v.price} Kč | Obnova: ${v.freq}`),
      ...rec.get("chunks").map(c => `ZDROJ: ${c.src} (URL: ${c.url}) | TEXT: ${c.text}`)
    ].join("\n\n");

    const contents = history.map(h => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.content }]
    }));

    // 3. System Prompt (Restored structure, 9th-grade level, tightened text)
    const systemPrompt = `Jsi seniorní poradce Ligy vozíčkářů. Piš pro žáka 9. třídy (jednoduše).
    PŘÍSNÝ ZÁKAZ: Pozdravy, úvodní vata. Začni přímo ## Stručně.

    STRUKTURA:
    1. ## Stručně: Použij 3-5 jasných odrážek. Žádné tabulky.
    2. ## Podrobné vysvětlení: Krátké věty. Žádná zbytečná slova.
    3. PENÍZE: Formát 10.000 Kč.
    4. ZDROJE: 3 hlavní jako odrážky, zbytek v <details><summary>Všechny použité zdroje</summary>...</details>.

    DŮLEŽITÁ FAKTA:
    - Odborný lékař (specialista) musí pomůcku vždy předepsat.
    - Pojišťovna platí běžné věci přes poukaz.
    - Úřad práce dává příspěvek na drahé "zvláštní pomůcky" (auto, úprava bytu).
    - Pokud pomůcku zaplatí Úřad práce, je vaše a nemusíte ji vracet.

    DATA: ${context}
    OTÁZKA: ${question}`;

    contents.push({ role: "user", parts: [{ text: systemPrompt }] });

    // 4. Final Generation
    const genReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents })
    });

    const genData = await genReq.json();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: genData.candidates[0].content.parts[0].text.trim() })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  } finally {
    await session.close();
  }
};
