const functions = require('@google-cloud/functions-framework');
const neo4j = require("neo4j-driver");

const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS));

functions.http('search', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Timeout: Search took too long")), 9500)
  );

  try {
    const requestLogic = async () => {
      const { question, history = [], model = "gemini-2.0-flash-lite" } = req.body || {};
      if (!question) throw new Error("Missing question");

      const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "models/embedding-001", content: { parts: [{ text: question }] } })
      });
      const embData = await embReq.json();
      const qVector = embData.embedding.values;

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
      if (!chunks || chunks.length === 0) return { answer: "Nenalezena žádná data." };

      const context = chunks.map(c => `DOKUMENT: ${c.src} | TEXT: ${c.text}`).join("\n\n");

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
      const rawAiOutput = genData.candidates[0].content.parts[0].text;
      const uniqueDocs = Array.from(new Set(chunks.map(c => JSON.stringify({src: c.src, url: c.url})))).map(str => JSON.parse(str));

      try {
        const responseJson = JSON.parse(rawAiOutput);
        const summary = Array.isArray(responseJson.summary) ? responseJson.summary.join('\n') : responseJson.summary;
        const detail = Array.isArray(responseJson.detail) ? responseJson.detail.join('\n') : responseJson.detail;
        return { answer: `## Stručně\n${summary}\n\n## Detail\n${detail}\n\n## Zdroje\n${uniqueDocs.map(d => `- [${d.src}](${d.url})`).join('\n')}` };
      } catch (e) {
        return { answer: rawAiOutput };
      }
    };

    const finalAnswer = await Promise.race([requestLogic(), timeout]);
    res.status(200).json(finalAnswer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
