const functions = require('@google-cloud/functions-framework');
const neo4j = require("neo4j-driver");

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS)
);

functions.http('search', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") return res.status(204).send('');

  try {
    const { question, history = [], model = "gemini-2.0-flash-lite" } = req.body || {};
    if (!question) throw new Error("Missing question");

    // 1. Get Embeddings
    const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: "models/text-embedding-004", content: { parts: [{ text: question }] } })
    });
    const embData = await embReq.json();
    const qVector = embData.embedding.values;

    // 2. Query Neo4j (Vector + Graph traversal)
    const session = driver.session();
    const query = `
      CALL db.index.vector.queryNodes('chunk_vector_index', 5, $vec)
      YIELD node, score
      MATCH (node)-[:PART_OF]->(d:Document)
      RETURN collect(DISTINCT { text: node.text, src: d.human_name, url: d.url }) AS chunks
    `;
    const result = await session.run(query, { vec: qVector }).finally(() => session.close());
    const chunks = result.records[0].get("chunks");

    if (!chunks.length) return res.status(200).json({ answer: "No data found." });

    // 3. Generate Answer
    const context = chunks.map(c => `SOURCE: ${c.src} | CONTENT: ${c.text}`).join("\n\n");
    const genReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          ...history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] })),
          { role: "user", parts: [{ text: `CONTEXT:\n${context}\n\nQUESTION: ${question}\n\nAnswer strictly based on the context.` }] }
        ]
      })
    });

    const genData = await genReq.json();
    const answer = genData.candidates[0].content.parts[0].text;
    res.status(200).json({ answer, sources: chunks });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
