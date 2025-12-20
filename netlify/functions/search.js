const neo4j = require("neo4j-driver");
const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS));

exports.handler = async (event) => {
  const { question, history = [], model = "gemini-2.5-flash" } = JSON.parse(event.body);
  const session = driver.session();

  try {
    const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: "models/embedding-001", content: { parts: [{ text: question }] } })
    });
    const embData = await embReq.json();
    const qVector = embData.embedding.values;

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

    // FIX 1: Safety check to prevent 500 error when DB returns nothing
    if (!result.records || result.records.length === 0) {
        return { statusCode: 200, body: JSON.stringify({ answer: "## Stručně\n* Lituji, ale v databázi nebyly nalezeny žádné relevantní informace.\n\n## Podrobné vysvětlení\nPro vaši otázku nemáme v systému podklady. Obraťte se prosím na Poradnu Ligy vozíčkářů." }) };
    }

    const rec = result.records[0];
    const chunks = rec.get("chunks") || [];
    const graphData = rec.get("graphData") || [];

    const context = [
      ...graphData.filter(v => v.name).map(v => `DATA: ${v.name} | Cena: ${v.price} Kč | Obnova: ${v.freq}`),
      ...chunks.map(c => `DOKUMENT: ${c.src} | TEXT: ${c.text}`)
    ].join("\n\n");

    const systemPrompt = `Jsi seniorní poradce Ligy vozíčkářů. Piš pro žáka 9. třídy.
    Odpověz v JSON: {"summary": ["odrážka"], "detail": "vysvětlení"}.
    PRAVIDLA:
    1. Odpovídej VÝHRADNĚ podle dodaných DATA. Pokud informace v DATA nejsou, přiznej to a odkaž na Poradnu Ligy vozíčkářů.
    2. NIKDY si nevymýšlej žádná fakta, ceny ani postupy, které nejsou v DATA.
    3. Pokud se dotaz týká práce při důchodu, MUSÍŠ uvést riziko lékařského přezkoumání a snížení stupně důchodu, pokud je to v DATA.
    4. ZÁKAZ inline citací. Tisíce odděluj tečkou (10.000 Kč).
    DATA: ${context}
    OTÁZKA: ${question}`;

    const genReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [...history.map(h => ({role: h.role === 'user' ? 'user' : 'model', parts: [{text: h.content}]})), { role: "user", parts: [{ text: systemPrompt }] }],
        generationConfig: {
            response_mime_type: "application/json",
            temperature: 0.0 // FIX 2: Stop hallucinations/lying
        }
      })
    });

    const genData = await genReq.json();

    // FIX 3: Robust JSON extraction to prevent 500 error from malformed AI output
    let rawText = genData.candidates[0].content.parts[0].text;
    const cleanJson = rawText.replace(/```json|```/g, "").trim();
    const responseJson = JSON.parse(cleanJson);

    const uniqueDocs = Array.from(new Set(chunks.map(c => JSON.stringify({src: c.src, url: c.url}))))
                            .map(str => {
                              const d = JSON.parse(str);
                              let cleanTitle = d.src.replace(/-/g, ' ');
                              cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);
                              return { src: cleanTitle, url: d.url };
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
    // FIX 4: Detailed error logging so you know exactly what failed
    console.error("SEARCH ERROR:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message, stack: err.stack }) };
  } finally {
    await session.close();
  }
};
