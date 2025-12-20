const neo4j = require("neo4j-driver");
const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS));

exports.handler = async (event) => {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Timeout: Search took too long")), 9500)
  );

  try {
    const requestLogic = async () => {
      const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body;
      const { question, history = [], model = "gemini-2.0-flash" } = JSON.parse(body || "{}");

      if (!question) throw new Error("Missing question");

      // 1. Embedding
      const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "models/embedding-001", content: { parts: [{ text: question }] } })
      });
      const embData = await embReq.json();
      if (!embData.embedding) throw new Error("Embedding failed");
      const qVector = embData.embedding.values;

      // 2. Neo4j - Secure record access
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

      const chunks = (result.records.length > 0) ? result.records[0].get("chunks") : [];
      if (!chunks || chunks.length === 0) return { statusCode: 200, body: JSON.stringify({ answer: "Nenalezena žádná data v databázi." }) };

      const context = chunks.map(c => `DOKUMENT: ${c.src} | TEXT: ${c.text}`).join("\n\n");

      // 3. AI Generation
      const genReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            ...history.map(h => ({role: h.role === 'user' ? 'user' : 'model', parts: [{text: h.content}]})),
            { role: "user", parts: [{ text: `DATA: ${context}\nOTÁZKA: ${question}\n\nOdpověz ve formátu JSON s klíči "summary" (pole řetězců) a "detail" (dlouhý text).` }] }
          ],
          generationConfig: { response_mime_type: "application/json", temperature: 0.0 }
        })
      });

      const genData = await genReq.json();
      if (!genData.candidates || !genData.candidates[0]) throw new Error("AI response empty");

      const rawAiOutput = genData.candidates[0].content.parts[0].text;
      let finalAnswer = "";

      try {
        // Attempt to parse JSON and extract data
        const responseJson = JSON.parse(rawAiOutput);
        const summary = Array.isArray(responseJson.summary) ? responseJson.summary.join('\n') : (responseJson.summary || "");
        const detail = responseJson.detail || responseJson.answer || JSON.stringify(responseJson);

        finalAnswer = `## Stručně\n${summary}\n\n## Detail\n${detail}`;
      } catch (parseError) {
        // Fallback: If JSON parsing fails, just show the raw text so the user sees SOMETHING
        finalAnswer = `## Odpověď\n${rawAiOutput}`;
      }

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: finalAnswer })
      };
    };

    return await Promise.race([requestLogic(), timeout]);

  } catch (err) {
    console.error("Error:", err.message);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
