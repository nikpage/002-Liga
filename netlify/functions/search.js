const neo4j = require("neo4j-driver");

/* ---------- INTENT TRIAGE (FAST, DETERMINISTIC) ---------- */
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
          parts: [{
            text: `
Classify the question into ONE category:
STRUCTURED = who/where/relationships/prescription/providers
TEXT = explanation/definition/how it works
MIXED = both
UNCLEAR = cannot determine

Reply with ONE WORD only.
Question: ${question}
            `.trim()
          }]
        }]
      })
    }
  );

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "UNCLEAR";
}

/* ---------- HANDLER ---------- */
exports.handler = async (event) => {
  const { question, history = [], model = "gemini-2.5-flash" } =
    JSON.parse(event.body || "{}");

  if (!question) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing question" })
    };
  }

  const intent = await classifyIntent(question);

  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS)
  );
  const session = driver.session();

  try {
    let context = "";

    /* ---------- STRUCTURED ONLY (NO VECTORS) ---------- */
    if (intent === "STRUCTURED") {
      const result = await session.run(
        `
        MATCH (e:Equipment)-[r]->(o)
        WHERE toLower(e.name) CONTAINS toLower($q)
        RETURN e.name AS equipment, type(r) AS rel, labels(o) AS targetLabels, o.name AS target
        LIMIT 20
        `,
        { q: question }
      );

      context = result.records
        .map(r =>
          `${r.get("equipment")} — ${r.get("rel")} → ${r.get("target")} (${r.get("targetLabels").join(", ")})`
        )
        .join("\n");
    }

    /* ---------- TEXT ONLY (VECTORS ONLY) ---------- */
    if (intent === "TEXT") {
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
      const qVector = embData.embedding.values;

      const result = await session.run(
        `
        CALL db.index.vector.queryNodes('chunk_vector_index', 6, $vec)
        YIELD node, score
        MATCH (node)-[:PART_OF]->(d:Document)
        RETURN node.text AS text, d.human_name AS src, d.url AS url
        `,
        { vec: qVector }
      );

      context = result.records
        .map(r => `ZDROJ: ${r.get("src")} (${r.get("url")})\n${r.get("text")}`)
        .join("\n\n");
    }

    /* ---------- MIXED (VECTORS → NARROW GRAPH) ---------- */
    if (intent === "MIXED") {
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
      const qVector = embData.embedding.values;

      const result = await session.run(
        `
        CALL db.index.vector.queryNodes('chunk_vector_index', 4, $vec)
        YIELD node, score
        MATCH (node)-[:PART_OF]->(d:Document)
        OPTIONAL MATCH (e:Equipment)-[:HAS_VARIANT]->(v:EquipmentVariant)
        WHERE toLower(v.variant_name) CONTAINS toLower($q)
        RETURN
          collect(DISTINCT node.text) AS texts,
          collect(DISTINCT v.variant_name) AS variants
        `,
        { vec: qVector, q: question }
      );

      const record = result.records[0];
      context = [
        ...(record.get("variants") || []).map(v => `VARIANTA: ${v}`),
        ...(record.get("texts") || [])
      ].join("\n\n");
    }

    /* ---------- UNCLEAR ---------- */
    if (intent === "UNCLEAR") {
      return {
        statusCode: 200,
        body: JSON.stringify({
          answer: "Dotazu nerozumím. Zkuste ho prosím napsat jinak nebo doplnit."
        })
      };
    }

    /* ---------- FINAL ANSWER (SAME MODEL) ---------- */
    const contents = history.map(h => ({
      role: h.role === "user" ? "user" : "model",
      parts: [{ text: h.content }]
    }));

    contents.push({
      role: "user",
      parts: [{
        text: `
DATA:
${context}

OTÁZKA:
${question}
        `.trim()
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
    const answer = genData.candidates?.[0]?.content?.parts?.[0]?.text || "";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: answer.trim(), intent })
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
