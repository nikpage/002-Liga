const neo4j = require("neo4j-driver");

exports.handler = async (event) => {
  const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS));
  const { question, history = [], model = "gemini-3-flash" } = JSON.parse(event.body);
  const session = driver.session();

  try {
    const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "models/embedding-001", content: { parts: [{ text: question }] } })
    });
    const { embedding: { values: qVector } } = await embReq.json();

    const result = await session.run(`
      CALL db.index.vector.queryNodes('chunk_vector_index', 5, $vec)
      YIELD node, score
      OPTIONAL MATCH (node)-[:PART_OF]->(d:Document)
      OPTIONAL MATCH (v:EquipmentVariant) 
      WHERE any(word IN split(toLower($q), ' ') WHERE v.variant_name CONTAINS word)
      RETURN 
        collect(DISTINCT {text: node.text, src: coalesce(d.human_name, node['id:ID']), url: d.url}) AS chunks,
        collect(DISTINCT {name: v.variant_name, price: v.coverage_czk_without_dph, freq: v.doba_uziti}) AS specifics
    `, { vec: qVector, q: question.toLowerCase() });

    const record = result.records[0];
    const context = [
      ...record.get("specifics").filter(v => v.name).map(v => `DATA: ${v.name} | Úhrada: ${v.price} Kč | Obnova: ${v.freq}`),
      ...record.get("chunks").map(c => `ZDROJ: ${c.src} (Link: ${c.url || 'N/A'}) | TEXT: ${c.text}`)
    ].join("\n\n");

    const prompt = `Jsi seniorní poradce Ligy vozíčkářů. Odpovídáš handicapovaným lidem (úroveň 9. třídy ZŠ).
    
    PRAVIDLA FORMÁTU:
    1. ZAČNI nadpisem '### HLAVNÍ BODY' (TL;DR). Použij tabulku pro peníze/lhůty. 
    2. PAK '### DETAILNÍ VYSVĚTLENÍ'. Žádné zdvořilostní kecy na začátku.
    3. ČÍSLA: Tisíce odděluj tečkou (např. 6.957 Kč).
    4. ZDROJE: Na konci vypiš 3 nejdůležitější zdroje jako funkční odkazy [Název](URL). Pokud URL není, dej jen název.
    5. KONTAKT: info@ligavozic.cz.
    6. TLAČÍTKA: Na konec dej '///SUGGESTIONS///' a pod to 3 věcné otázky na 1 řádek.

    KONTEXT: ${context}
    OTÁZKA: ${question}`;

    const genReq = await fetch(\`https://generativelanguage.googleapis.com/v1beta/models/\${model}:generateContent?key=\${process.env.GOOGLE_API_KEY}\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const genData = await genReq.json();
    let answer = genData.candidates[0].content.parts[0].text;
    
    const parts = answer.split("///SUGGESTIONS///");
    return { 
      statusCode: 200, 
      body: JSON.stringify({ 
        answer: parts[0].trim(), 
        suggestions: parts[1] ? parts[1].split("\n").filter(s => s.trim()).slice(0,3) : [] 
      }) 
    };
  } finally {
    await session.close();
    await driver.close();
  }
};
