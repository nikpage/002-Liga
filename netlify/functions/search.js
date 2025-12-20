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

    const records = result.records;
    if (!records || records.length === 0 || records[0].get("chunks").length === 0) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer: "## Stručně\n* Lituji, ale v databázi nebyly nalezeny žádné relevantní informace.\n\n## Podrobné vysvětlení\nPro vaši otázku nemáme v systému podklady. Obraťte se prosím na Poradnu Ligy vozíčkářů." })
      };
    }

    const rec = records[0];
    const chunks = rec.get("chunks");
    const graphData = rec.get("graphData");

    const context = [
      ...graphData.filter(v => v.name).map(v => `DATA: ${v.name} | Cena: ${v.price} Kč | Obnova: ${v.freq}`),
      ...chunks.map(c => `DOKUMENT: ${c.src} | TEXT: ${c.text}`)
    ].join("\n\n");

    const systemPrompt = `Jsi seniorní poradce Ligy vozíčkářů. Piš pro žáka 9. třídy.
    Odpověz v JSON: {"summary": ["odrážka"], "detail": "vysvětlení"}.

    PŘÍSNÁ PRAVIDLA PRO ÚPLNOST A PRAVDU:
    1. ZPRACOVÁNÍ DATA: Musíš projít veškerá poskytnutá DATA a DOKUMENTY. Nic nevynechávej. Pokud je v DATA uvedena cena, termín nebo podmínka, MUSÍ být v detailu.
    2. ZÁKAZ STRUČNOSTI NA ÚKOR OBSAHU: Pokud jsou v DATA 3 varianty vozíku, popiš všechny 3.
    3. FALLBACK: Pokud v DATA není odpověď, napiš: "Lituji, ale pro tuto otázku nemám v databázi dostatek informací. Obraťte se na Poradnu Ligy vozíčkářů."
    4. ŽÁDNÉ VYMÝŠLENÍ: Nikdy nedoplňuj informace z vlastní hlavy. Použij jen to, co je v sekci DATA.
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
    const rawText = genData.candidates[0].content.parts[0].text;
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
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  } finally {
    await session.close();
  }
};
