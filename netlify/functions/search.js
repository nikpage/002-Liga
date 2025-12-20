// BUILD_VER_5.2_FIXED_PATH
const neo4j = require("neo4j-driver");

exports.handler = async (event) => {
  const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS));
  const { question, history = [], model = "gemini-3-flash" } = JSON.parse(event.body);
  const session = driver.session();

  try {
    const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "models/embedding-001", content: { parts: [{ text: question }] } })
    });
    const { embedding: { values: qVector } } = await embReq.json();

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
      ...record.get("chunks").map(c => `ZDROJ: ${c.src} (URL: ${c.url}) | TEXT: ${c.text}`)
    ].join("\n\n");

    const prompt = `[V 5.2] Jsi odborný poradce Ligy vozíčkářů. Mluv srozumitelně (CZ 9. třída).

    1. ZAČNI '## Stručně'. Dej fakta a peníze do Markdown tabulky. 
    2. PAK '## Podrobné vysvětlení'. Jdi k věci, žádný balast.
    3. ČÍSLA: Tisíce odděluj tečkou (10.000 Kč).
    4. VÝPOČET: Pokud je cena pod 10.000 Kč, vysvětli limit 8x živ. minimum (8 * 4.620 Kč = 36.960 Kč).
    5. ZDROJE: Na konci max 3 nejdůležitější odkazy [Název dokumentu](URL).
    6. KONTAKT: info@ligavozic.cz.
    7. TLAČÍTKA: Na konec napiš '///SUGGESTIONS///' a pod to 3 otázky na 1 řádek.

    DATA: ${context}
    OTÁZKA: ${question}`;

    const genReq = await fetch(\`https://generativelanguage.googleapis.com/v1beta/models/\${model}:generateContent?key=\${process.env.GOOGLE_API_KEY}\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const genData = await genReq.json();
    let answer = genData.candidates[0].content.parts[0].text;
    
    const parts = answer.split("///SUGGESTIONS///");
    return { 
      statusCode: 200, 
      body: JSON.stringify({ 
        answer: parts[0].trim(), 
        suggestions: parts[1] ? parts[1].split("\n").filter(s => s.trim()).slice(0,3) : [] 
      }) 
    };
  } finally {
    await session.close();
    await driver.close();
  }
};
