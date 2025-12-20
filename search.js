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
    // 1. NEUTRAL VECTOR SEARCH: Find the best 5 chunks on ANY topic
    const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "models/embedding-001", content: { parts: [{ text: question }] } })
    });
    const { embedding: { values: qVector } } = await embReq.json();

    // 2. HOLISTIC GRAPH TRAVERSAL: Get the text + the Document Source + related entities
    const result = await session.run(`
      CALL db.index.vector.queryNodes('chunk_vector_index', 5, $vec)
      YIELD node, score
      MATCH (node)-[:PART_OF]->(d:Document)
      OPTIONAL MATCH (node)-[:IS_ASSOCIATED_WITH|CONCERNS|APPLIES_TO]-(related)
      RETURN 
        node.text AS text, 
        d.name AS source, 
        collect(DISTINCT coalesce(related.name, labels(related)[0])) AS related_info
    `, { vec: qVector });

    const context = result.records.map(r => {
        return `[ZDROJ: ${r.get("source")}]\nTEXT: ${r.get("text")}\nSOUVISLOSTI: ${r.get("related_info").join(", ")}`;
    }).join("\n\n---\n\n");

    // 3. CASEWORKER REASONING PROMPT
    const prompt = `Jsi vysoce kvalifikovaný sociální poradce pro českou charitu pomáhající lidem s handicapem. 
TVŮJ CÍL: Poskytnout lidskou, přesnou a specifickou odpověď založenou na dodaných datech.

POKYNY PRO UVAŽOVÁNÍ:
- Pokud se uživatel ptá na konkrétní věc (např. podsedák), a ty vidíš, že cena je pod 10 000 Kč, uplatni pravidla pro drobné pomůcky (opakované žádosti, limit 8x životní minimum)[cite: 4, 10].
- Pokud je pomůcka drahá, zmiň souhrnný limit 800 000 Kč za 5 let.
- Pokud odpověď není v datech explicitně, INFERUJ ji (např. "Podsedák je levná věc, takže se na něj pravděpodobně vztahují tato pravidla..."). Vždy uveď, že jde o tvůj úsudek a proč si to myslíš.
- NIKDY nepoužívej interní kódy (chunk_1). Používej názvy dokumentů (Příručka pro zaměstnanost).
- VŽDY zakonči odpověď doporučením kontaktovat lidský helpdesk pro finální ověření.

KONTEXT Z DATABÁZE:
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
