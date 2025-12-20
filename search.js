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
    // 1. Get Embedding
    const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "models/embedding-001", content: { parts: [{ text: question }] } })
    });
    const embData = await embReq.json();
    const qVector = embData.embedding.values;

    // 2. SEARCH: Get specific equipment + the best text chunks
    const result = await session.run(`
      CALL db.index.vector.queryNodes('chunk_vector_index', 6, $vec)
      YIELD node, score
      OPTIONAL MATCH (node)-[:PART_OF]->(d:Document)
      WITH node, score, d
      ORDER BY score DESC
      
      // Pull specific equipment info if it matches terms in the question
      OPTIONAL MATCH (v:EquipmentVariant)
      WHERE any(word IN split(toLower($q), ' ') WHERE v.variant_name CONTAINS word)
      
      RETURN 
        collect(DISTINCT {text: node.text, src: coalesce(node.source_name, d.name, 'Neznámý zdroj')})[0..3] AS text_chunks,
        collect(DISTINCT {name: v.variant_name, price: v.coverage_czk_without_dph, frequency: v.doba_uziti})[0..3] AS equipment
    `, { vec: qVector, q: question.toLowerCase() });

    const record = result.records[0];
    const textData = record.get("text_chunks");
    const equipData = record.get("equipment");

    const context = [
      ...equipData.filter(e => e.name).map(e => `TABULKOVÉ DATA: Pomůcka ${e.name}, Úhrada: ${e.price} Kč, Častost: ${e.frequency}`),
      ...textData.map(t => `DOKUMENT (${t.src}): ${t.text}`)
    ].join("\n\n");

    const prompt = `Jsi odborný poradce charity pro handicapované. 
PRAVIDLA ODPOVĚDI:
- Pokud se ptají na konkrétní věc (podsedák, vozík), začni hned cenou a frekvencí.
- Podsedák na vozík je LEVNÁ pomůcka (obvykle pod 10 000 Kč). U takových věcí ignoruj limity 800 000 Kč a soustřeď se na pravidla pro drobné pomůcky.
- Nepoužívej interní ID dokumentů. Cituj "Zdroj: [název dokumentu]".
- Vždy nabídni kontakt na lidský helpdesk.

DATA Z DATABÁZE:
${context}

OTÁZKA: ${question}`;

    const genReq = await fetch(\`https://generativelanguage.googleapis.com/v1beta/models/\${model}:generateContent?key=\${process.env.GOOGLE_API_KEY}\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const genData = await genReq.json();

    return { 
      statusCode: 200, 
      body: JSON.stringify({ answer: genData.candidates[0].content.parts[0].text }) 
    };

  } finally {
    await session.close();
    await driver.close();
  }
};
