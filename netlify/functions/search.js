const neo4j = require("neo4j-driver");

/* ---------- FAST INTENT CLASSIFIER ---------- */
async function classifyIntent(question) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GOOGLE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generationConfig: { temperature: 0, maxOutputTokens: 5 },
        contents: [{
          role: "user",
          parts: [{ text: `STRUCTURED / TEXT / MIXED / UNCLEAR\nQuestion: ${question}` }]
        }]
      })
    }
  );
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "TEXT";
}

/* ---------- HANDLER ---------- */
exports.handler = async (event) => {
  const { question, history = [], model = "gemini-2.5-flash" } =
    JSON.parse(event.body || "{}");

  if (!question) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing question" }) };
  }

  const intent = await classifyIntent(question);

  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS)
  );
  const session = driver.session();

  try {
    /* ---------- ALWAYS VECTOR (FUZZY INPUT RESOLUTION) ---------- */
    const embReq = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/embedding-001",
          content: { parts: [{ text: question }] }
        })
      }
    );
    const embData = await embReq.json();
    const vec = embData.embedding.values;

    const vecResult = await session.run(
      `
      CALL db.index.vector.queryNodes('chunk_vector_index', 6, $vec)
      YIELD node, score
      MATCH (node)-[:PART_OF]->(d:Document)
      RETURN
        collect(DISTINCT node.text) AS texts,
        collect(DISTINCT d.human_name) AS sources,
        collect(DISTINCT d.url) AS urls
      `,
      { vec }
    );

    const record = vecResult.records[0];
    let contextParts = [];

    if (record) {
      record.get("texts").forEach(t => contextParts.push(t));
      record.get("sources").forEach((s, i) => {
        const url = record.get("urls")[i];
        contextParts.push(`ZDROJ: ${s}${url ? ` (${url})` : ""}`);
      });
    }

    /* ---------- GRAPH ONLY WHEN USEFUL ---------- */
    if (intent === "STRUCTURED" || intent === "MIXED") {
      const graphResult = await session.run(
        `
        MATCH (e:Equipment)-[r]->(o)
        WHERE any(word IN split(toLower($q),' ') WHERE toLower(e.name) CONTAINS word)
        RETURN DISTINCT e.name AS equipment, type(r) AS rel, o.name AS target
        LIMIT 20
        `,
        { q: question }
      );

      graphResult.records.forEach(r => {
        contextParts.push(
          `${r.get("equipment")} — ${r.get("rel")} → ${r.get("target")}`
        );
      });
    }

    if (contextParts.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          answer: "Dotazu nerozumím. Zkuste jej prosím upřesnit."
        })
      };
    }

    /* ---------- FINAL ANSWER ---------- */
    const contents = history.map(h => ({
      role: h.role === "user" ? "user" : "model",
      parts: [{ text: h.content }]
    }));

    contents.push({
      role: "user",
      parts: [{
        text: `DATA:\n${contextParts.join("\n\n")}\n\nOTÁZKA:\n${question}`
      }]
    });

    const genReq = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents })
      }
    );

    const genData = await genReq.json();
    const answer =
      genData.candidates?.[0]?.content?.parts?.[0]?.text || "";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: answer.trim() })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  } finally {
    await session.close();
    await driver.close();
  }
};
