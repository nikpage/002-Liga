const neo4j = require("neo4j-driver");
const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS));

exports.handler = async (event) => {
  const { question, history = [], model = "gemini-2.5-flash" } = JSON.parse(event.body);
  const session = driver.session();

  try {
    // 1. Vector Search
    const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: "models/embedding-001", content: { parts: [{ text: question }] } })
    });
    const embData = await embReq.json();
    const qVector = embData.embedding.values;

    // 2. Hybrid Query (Strict filter for valid names)
    const result = await session.run(`
      CALL db.index.vector.queryNodes('chunk_vector_index', 6, $vec)
      YIELD node, score
      MATCH (node)-[:PART_OF]->(d:Document)
      WHERE d.human_name IS NOT NULL AND d.url IS NOT NULL
      OPTIONAL MATCH (d)-[:INCLUDES|HAS_VARIANT|APPLIES_TO]->(v:EquipmentVariant)
      RETURN
        collect(DISTINCT {text: node.text, src: d.human_name, url: d.url}) AS chunks,
        collect(DISTINCT {name: v.variant_name, price: v.coverage_czk_without_dph, freq: v.doba_uziti}) AS graphData
    `, { vec: qVector });

    const rec = result.records[0];
    const chunks = rec.get("chunks");
    const graphData = rec.get("graphData");

    const context = [
      ...graphData.filter(v => v.name).map(v => `DATA: ${v.name} | Cena: ${v.price} Kč | Obnova: ${v.freq}`),
      ...chunks.map(c => `DOKUMENT: ${c.src} | TEXT: ${c.text}`)
    ].join("\n\n");

    // 3. System Prompt (NO CITATIONS, NO IDs IN TEXT)
    const systemPrompt = `Jsi seniorní poradce Ligy vozíčkářů. Piš pro žáka 9. třídy.
    Odpověz v JSON: {"summary": ["odrážka 1", "odrážka 2"], "detail": "Čistý text bez jakýchkoliv citací, ID nebo odkazů."}

    PRAVIDLA:
    - ZÁKAZ: Do textu (summary i detail) nikdy nepiš, SOURCE_ID nebo názvy zdrojů.
    - Používej pouze dodaná DATA.
    - Peníze: 10.000 Kč.
    - Odborný lékař předepisuje, Pojišťovna hradí poukaz, Úřad práce dává příspěvek.

    DATA: ${context}
    OTÁZKA: ${question}`;

    const genReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [...history.map(h => ({role: h.role === 'user' ? 'user' : 'model', parts: [{text: h.content}]})), { role: "user", parts: [{ text: systemPrompt }] }],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    const genData = await genReq.json();
    const responseJson = JSON.parse(genData.candidates[0].content.parts[0].text);

    // 4. Formatting Logic (Formatting and Capitalization fix)
    const uniqueDocs = Array.from(new Set(chunks.map(c => JSON.stringify({src: c.src, url: c.url}))))
                            .map(str => {
                               const d = JSON.parse(str);
                               // Capitalize first letter and fix common slugs
                               const cleanName = d.src.charAt(0).toUpperCase() + d.src.slice(1);
                               return { src: cleanName, url: d.url };
                            });

    const finalAnswer = [
      `## Stručně`,
      responseJson.summary.map(s => `* ${s}`).join('\n'),
      `\n## Podrobné vysvětlení`,
      responseJson.detail,
      `\n### Zdroje`,
      uniqueDocs.slice(0, 3).map(d => `* [${d.src}](${d.url})`).join('\n'),
      `\n<details><summary>Všechny použité zdroje</summary>\n\n${uniqueDocs.map(d => `* [${d.src}](${d.url})`).join('\n')}\n</details>`
    ].join('\n');

    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: finalAnswer }) };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  } finally
