const neo4j = require("neo4j-driver");

exports.handler = async (event) => {
  const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS));
  const { question, history = [], model = "gemini-3-flash" } = JSON.parse(event.body);
  const session = driver.session();

  try {
    // 1. Get embedding for the question
    const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: "models/embedding-001", content: { parts: [{ text: question }] } })
    });
    const embData = await embReq.json();
    const qVector = embData.embedding.values;

    // 2. Query Neo4j for relevant chunks and equipment specifics
    const result = await session.run(`
      CALL db.index.vector.queryNodes('chunk_vector_index', 6, $vec)
      YIELD node, score
      MATCH (node)-[:PART_OF]->(d:Document)
      OPTIONAL MATCH (v:EquipmentVariant)
      WHERE any(word IN split(toLower($q), ' ') WHERE v.variant_name CONTAINS word)
      RETURN
        collect(DISTINCT {text: node.text, src: d.human_name, url: d.url}) AS chunks,
        collect(DISTINCT {name: v.variant_name, price: v.coverage_czk_without_dph, freq: v.doba_uziti}) AS specifics
    `, { vec: qVector, q: question.toLowerCase() });

    const record = result.records[0];
    const context = [
      ...record.get("specifics").filter(v => v.name).map(v => `TABULKA: ${v.name} | Úhrada: ${v.price} Kč | Obnova: ${v.freq}`),
      ...record.get("chunks").map(c => `ZDROJ: ${c.src} (Link: ${c.url}) | TEXT: ${c.text}`)
    ].join("\n\n");

    // 3. Construct conversation history for Gemini
    const contents = history.map(item => ({
      role: item.role === 'user' ? 'user' : 'model',
      parts: [{ text: item.content }]
    }));

    // Add the current prompt
    const systemPrompt = `Jsi seniorní poradce Ligy vozíčkářů. Pomáháš handicapovaným lidem věcně a lidsky (úroveň 9. třídy ZŠ).

    STRUKTURA ODPOVĚDI:
    1. ZAČNI '## Stručně'. Vytvoř přehlednou Markdown tabulku (např. Položka | Fakt | Detail). Buď extrémně věcný.
    2. NÁSLEDUJE '## Podrobné vysvětlení'. Jdi k věci bez úvodních frází.
    3. PENÍZE: Tisíce odděluj tečkou (10.000 Kč).
    4. VÝPOČET: Pro věci pod 10k Kč vysvětli limit 8x životní minimum (8 * 4.620 Kč = 36.960 Kč).
    5. ZDROJE:
       - Vypiš 3 nejdůležitější jako: [Název dokumentu](URL).
       - Ostatní zdroje uveď v sekci: '<details><summary>Všechny použité zdroje</summary>...seznam odkazů...</details>'.
    6. EMAIL: Vygeneruj sekci '### Návrh e-mailu pro poradnu' s předpřipraveným textem pro info@ligavozic.cz obsahujícím shrnutí tohoto chatu.
    7. TLAČÍTKA: Na úplný konec napiš '///SUGGESTIONS///' a pod to 3 otázky na 1 řádek.

    DATA PRO ODPOVĚĎ: ${context}
    OTÁZKA: ${question}`;

    contents.push({ role: "user", parts: [{ text: systemPrompt }] });

    // 4. Call Gemini
    const genReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents })
    });

    const genData = await genReq.json();
    const answer = genData.candidates[0].content.parts[0].text;

    const [mainPart, suggestionsPart] = answer.split("///SUGGESTIONS///");

    return {
      statusCode: 200,
      body: JSON.stringify({
        answer: mainPart.trim(),
        suggestions: suggestionsPart ? suggestionsPart.split("\n").filter(s => s.trim()).slice(0, 3) : []
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  } finally {
    await session.close();
    await driver.close();
  }
};
