const neo4j = require("neo4j-driver");
const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS));

exports.handler = async (event) => {
  const { question, history = [], model = "gemini-2.5-flash" } = JSON.parse(event.body);
  const session = driver.session();

  try {
    // 1. Vector Generation
    const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: "models/embedding-001", content: { parts: [{ text: question }] } })
    });
    const embData = await embReq.json();
    const qVector = embData.embedding.values;

    // 2. Hybrid Search (INCLUDES, HAS_VARIANT, APPLIES_TO)
    const result = await session.run(`
      CALL db.index.vector.queryNodes('chunk_vector_index', 6, $vec)
      YIELD node, score
      MATCH (node)-[:PART_OF]->(d:Document)
      OPTIONAL MATCH (d)-[:INCLUDES|HAS_VARIANT|APPLIES_TO]->(v:EquipmentVariant)
      RETURN
        collect(DISTINCT {text: node.text, src: d.human_name, url: d.url, id: id(node)}) AS chunks,
        collect(DISTINCT {name: v.variant_name, price: v.coverage_czk_without_dph, freq: v.doba_uziti}) AS graphData
    `, { vec: qVector });

    const rec = result.records[0];
    const chunks = rec.get("chunks");
    const graphData = rec.get("graphData");

    const context = [
      ...graphData.filter(v => v.name).map(v => `EQUIPMENT DATA: ${v.name} | Price: ${v.price} Kč | Frequency: ${v.freq}`),
      ...chunks.map(c => `SOURCE ID ${c.id}: ${c.src} (URL: ${c.url}) | TEXT: ${c.text}`)
    ].join("\n\n");

    // 3. Content-Only Prompt (No formatting instructions here)
    const systemPrompt = `Jsi seniorní poradce. Piš pro žáka 9. třídy.
    Odpověz ve formátu JSON se dvěma poli: "summary" (pole krátkých odrážek) a "detail" (odstavec textu).

    PRAVIDLA:
    - Každou informaci zakonči podle zdroje. Nikdy nedávej citaci na začátek.
    - Pojišťovna hradí věci přes poukaz od specialisty.
    - Úřad práce dává příspěvek na drahé pomůcky (auto, schodolez).
    - Žádné pozdravy. Tisíce odděluj tečkou (10.000 Kč).

    DATA: ${context}
    OTÁZKA: ${question}`;

    const contents = [...history.map(h => ({role: h.role === 'user' ? 'user' : 'model', parts: [{text: h.content}]})),
                      { role: "user", parts: [{ text: systemPrompt }] }];

    const genReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents, generationConfig: { response_mime_type: "application/json" } })
    });

    const genData = await genReq.json();
    const responseJson = JSON.parse(genData.candidates[0].content.parts[0].text);

    // 4. FORMATTING OUTSIDE THE PROMPT (Hard-coded structure)
    const top3Sources = chunks.slice(0, 3);
    const otherSources = chunks.slice(3);

    const finalAnswer = [
      `## Stručně`,
      responseJson.summary.map(s => `* ${s}`).join('\n'),
      `\n## Podrobné vysvětlení`,
      responseJson.detail,
      `\n### Zdroje`,
      top3Sources.map(s => `* [${s.src}](${s.url})`).join('\n'),
      `\n<details>`,
      `<summary>Všechny použité zdroje</summary>\n`,
      chunks.map(s => `* [${s.src}](${s.url})`).join('\n'),
      `</details>`
    ].join('\n');

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: finalAnswer })
    };

  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  } finally {
    await session.close();
  }
};
