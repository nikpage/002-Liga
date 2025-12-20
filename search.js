const neo4j = require("neo4j-driver");

exports.handler = async (event) => {
  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS)
  );

  const body = JSON.parse(event.body);
  const { question, history = [], model = "gemini-3-flash" } = body;

  const session = driver.session();
  try {
    // 1. Get Embedding for the query
    const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "models/embedding-001", content: { parts: [{ text: question }] } })
    });
    const { embedding: { values: qVector } } = await embReq.json();

    // 2. UNIVERSAL SEARCH: Pull 6 most relevant chunks + their graph connections
    const result = await session.run(`
      CALL db.index.vector.queryNodes('chunk_vector_index', 6, $vec)
      YIELD node, score
      MATCH (node)-[:PART_OF]->(d:Document)
      
      // Look for any specific variant data if it exists (e.g. Mechanical Wheelchair price)
      OPTIONAL MATCH (v:EquipmentVariant) 
      WHERE any(word IN split(toLower($q), ' ') WHERE v.variant_name CONTAINS word)

      RETURN 
        collect(DISTINCT {text: node.text, src: d.name}) AS chunks,
        collect(DISTINCT {name: v.variant_name, price: v.coverage_czk_without_dph, freq: v.doba_uziti}) AS specifics
    `, { vec: qVector, q: question.toLowerCase() });

    const record = result.records[0];
    const context = [
      ...record.get("specifics").filter(v => v.name).map(v => `PŘESNÁ DATA: ${v.name} | Úhrada: ${v.price} Kč | Obnova: ${v.freq}`),
      ...record.get("chunks").map(c => `KAPITOLA (${c.src.toUpperCase()}): ${c.text}`)
    ].join("\n\n---\n\n");

    // 3. HUMAN-QUALITY REASONING PROMPT
    const prompt = `Jsi seniorní sociální poradce české charity. Radíš lidem v těžké životní situaci (důchody, práce, pomůcky).
TVÉ POVINNOSTI:
- Pokud se uživatel ptá na "podsedák" nebo jinou levnou věc, použij logiku pro pomůcky pod 10 000 Kč (příjem pod 8x živ. min., opakované žádosti).
- Pokud se ptá na důchody nebo mateřskou, cituj přesné týdny a procenta z dat (např. 28 týdnů mateřská).
- Pokud v datech odpověď není, udělej "kvalifikovaný odhad" (inference). Např: "V tabulkách podsedák není, ale protože stojí obvykle 2000 Kč, platí pro něj tato pravidla..."
- NIKDY necituj ID jako 'chunk_1'. Používej lidské názvy dokumentů.
- Vždy nabídni kontakt na helpdesk pro potvrzení.

KONTEXT Z DATABÁZE:
${context}

OTÁZKA: ${question}`;

    const genReq = await fetch(\`https://generativelanguage.googleapis.com/v1beta/models/\${model}:generateContent?key=\${process.env.GOOGLE_API_KEY}\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const genData = await genReq.json();

    return { statusCode: 200, body: JSON.stringify({ answer: genData.candidates[0].content.parts[0].text }) };

  } finally {
    await session.close();
    await driver.close();
  }
};
