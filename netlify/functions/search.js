const neo4j = require("neo4j-driver");
const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS));

exports.handler = async (event) => {
  const { question, history = [], model = "gemini-2.5-flash" } = JSON.parse(event.body);
  const session = driver.session();

  try {
    // 1. Get Embedding (Fuzzy Logic)
    const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: "models/embedding-001", content: { parts: [{ text: question }] } })
    });
    const embData = await embReq.json();
    const qVector = embData.embedding.values;

    // 2. Hybrid Query (Vector -> Graph Jump)
    const result = await session.run(`
      CALL db.index.vector.queryNodes('chunk_vector_index', 5, $vec)
      YIELD node, score
      MATCH (node)-[:PART_OF]->(d:Document)
      OPTIONAL MATCH (d)-[:MENTIONS|REGULATES]->(v:EquipmentVariant)
      RETURN
        collect(DISTINCT {text: node.text, src: d.human_name, url: d.url}) AS chunks,
        collect(DISTINCT {name: v.variant_name, price: v.coverage_czk_without_dph, freq: v.doba_uziti}) AS graphData
    `, { vec: qVector });

    const rec = result.records[0];
    const context = [
      ...rec.get("graphData").filter(v => v.name).map(v => `DATA: ${v.name} | Cena: ${v.price} | Obnova: ${v.freq}`),
      ...rec.get("chunks").map(c => `ZDROJ: ${c.src} | TEXT: ${c.text}`)
    ].join("\n\n");

    // 3. Final Synthesis (Strictly gemini-2.5-flash)
    const genReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          ...history.map(h => ({role: h.role === 'user' ? 'user' : 'model', parts: [{text: h.content}]})),
          { role: "user", parts: [{ text: `Jsi seniorní poradce. Odpovídej věcně. DATA: ${context}\n\nOTÁZKA: ${question}` }] }
        ]
      })
    });

    const genData = await genReq.json();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: genData.candidates[0].content.parts[0].text })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  } finally {
    await session.close();
  }
};
