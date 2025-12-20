const neo4j = require("neo4j-driver");
const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS));

exports.handler = async (event) => {
  // 1. Create a timeout promise to prevent the 500 crash at 10s
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Timeout: Search took too long")), 9500)
  );

  try {
    const requestLogic = async () => {
      const { question, history = [], model = "gemini-2.0-flash" } = JSON.parse(event.body);

      // Embedding
      const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "models/embedding-001", content: { parts: [{ text: question }] } })
      });
      const embData = await embReq.json();
      if (!embData.embedding) throw new Error("Embedding failed");
      const qVector = embData.embedding.values;

      // Neo4j - Reduced limit to 4 to stay under 10s limit
      const session = driver.session();
      const result = await session.run(`
        CALL db.index.vector.queryNodes('chunk_vector_index', 4, $vec)
        YIELD node, score
        MATCH (node)-[:PART_OF]->(d:Document)
        OPTIONAL MATCH (d)-->(v:EquipmentVariant)
        RETURN collect(DISTINCT {
          text: node.text,
          src: d.human_name,
          url: d.url,
          variant: v.variant_name,
          price: v.coverage_czk_without_dph,
          freq: v.doba_uziti
        }) AS chunks
      `, { vec: qVector }).finally(() => session.close());

      const chunks = result.records[0].get("chunks") || [];
      if (chunks.length === 0) return { statusCode: 200, body: JSON.stringify({ answer: "Nenalezena žádná data." }) };

      const context = chunks.map(c => `DOKUMENT: ${c.src} | TEXT: ${c.text}`).join("\n\n");

      // AI Generation
      const genReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [...history.map(h => ({role: h.role === 'user' ? 'user' : 'model', parts: [{text: h.content}]})), { role: "user", parts: [{ text: `DATA: ${context}\nOTÁZKA: ${question}` }] }],
          generationConfig: { response_mime_type: "application/json", temperature: 0.0 }
        })
      });

      const genData = await genReq.json();
      const responseJson = JSON.parse(genData.candidates[0].content.parts[0].text);

      // FIXED: Safely handle uniqueDocs to prevent crash
      const uniqueDocs = Array.from(new Set(chunks.map(c => JSON.stringify({src: c.src || "Zdroj", url: c.url || "#"}))))
                              .map(str => JSON.parse(str));

      const finalAnswer = `## Stručně\n${responseJson.summary.join('\n')}\n\n## Detail\n${responseJson.detail}`;

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: finalAnswer })
      };
    };

    // Race the logic against the 9.5s timeout
    return await Promise.race([requestLogic(), timeout]);

  } catch (err) {
    console.error("Error detected:", err.message);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
