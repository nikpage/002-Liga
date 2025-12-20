const neo4j = require("neo4j-driver");
const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS));

exports.handler = async (event) => {
  const { question, history = [], model = "gemini-2.5-flash" } = JSON.parse(event.body);

  try {
    const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: "models/embedding-001", content: { parts: [{ text: question }] } })
    });
    const embData = await embReq.json();
    if (!embData.embedding) throw new Error("Embedding failed");
    const qVector = embData.embedding.values;

    const sessionV = driver.session();
    const sessionG = driver.session();

    const [vectorResult, graphResult] = await Promise.all([
      sessionV.run(`
        CALL db.index.vector.queryNodes('chunk_vector_index', 6, $vec)
        YIELD node, score
        MATCH (node)-[:PART_OF]->(d:Document)
        RETURN collect(DISTINCT {text: node.text, src: d.human_name, url: d.url}) AS chunks
      `, { vec: qVector }).finally(() => sessionV.close()),
      sessionG.run(`
        MATCH (v:EquipmentVariant)
        RETURN collect(DISTINCT {name: v.variant_name, price: v.coverage_czk_without_dph, freq: v.doba_uziti}) AS graphData
      `).finally(() => sessionG.close())
    ]);

    const chunks = vectorResult.records[0].get("chunks") || [];
    const graphData = graphResult.records[0].get("graphData") || [];

    const context = [
      ...graphData.filter(v => v.name).map(v => `DATA: ${v.name} | Cena: ${v.price} Kč | Obnova: ${v.freq}`),
      ...chunks.map(c => `DOKUMENT: ${c.src} | TEXT: ${c.text}`)
    ].join("\n\n");

    const systemPrompt = `Jsi seniorní poradce Ligy vozíčkářů. Piš pro žáka 9. třídy.
    Odpověz v JSON: {"summary": ["odrážka"], "detail": "vysvětlení"}.
    PŘÍSNÁ PRAVIDLA:
    1. ZPRACOVÁNÍ DATA: Projdi veškerá DATA a DOKUMENTY. Ceny, termíny a podmínky MUSÍ být v detailu.
    2. ZÁKAZ STRUČNOSTI: Pokud jsou v DATA varianty, popiš všechny.
    3. FALLBACK: Pokud v DATA není odpověď, odkaž na Poradnu Ligy vozíčkářů.
    4. ŽÁDNÉ VYMÝŠLENÍ: Použij jen fakta ze sekce DATA.
    5. FORMÁT: Tisíce odděluj tečkou (10.000 Kč). ZÁKAZ inline citací.
    DATA: ${context}
    OTÁZKA: ${question}`;

    const genReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [...history.map(h => ({role: h.role === 'user' ? 'user' : 'model', parts: [{text: h.content}]})), { role: "user", parts: [{ text: systemPrompt }] }],
        generationConfig: { response_mime_type: "application/json", temperature: 0.0 }
      })
    });

    const genData = await genReq.json();
    if (!genData.candidates || !genData.candidates[0].content.parts[0].text) throw new Error("AI Generation failed");

    let rawText = genData.candidates[0].content.parts[0].text;
    let responseJson;
    try {
      responseJson = JSON.parse(rawText.replace(/```json|```/g, "").trim());
    } catch (parseError) {
      throw new Error("Chyba při parsování odpovědi AI: " + parseError.message);
    }

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
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
