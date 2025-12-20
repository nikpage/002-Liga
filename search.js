const neo4j = require("neo4j-driver");

exports.handler = async (event) => {
  const driver = neo4j.driver(process.env.NEO4J_URI, neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS));
  const { question, history = [], model = "gemini-3-flash" } = JSON.parse(event.body);
  const session = driver.session();

  try {
    const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: "models/embedding-001",
            content: { parts: [{ text: question }] }
        })
    });
    const embData = await embReq.json();
    const qVector = embData.embedding.values;

    // We pull the human_name and url we injected into the DB
    const result = await session.run(`
      CALL db.index.vector.queryNodes('chunk_vector_index', 5, $vec)
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
      ...record.get("specifics").filter(v => v.name).map(v => `PŘESNÁ DATA: ${v.name} | Úhrada: ${v.price} Kč | Obnova: ${v.freq}`),
      ...record.get("chunks").map(c => `ZDROJ: ${c.src} (URL: ${c.url}) | TEXT: ${c.text}`)
    ].join("\n\n");

    const prompt = `[VER 4.1] Jsi seniorní sociální poradce Ligy vozíčkářů. 
    Mluvíš s lidmi s handicapem (úroveň 9. třídy ZŠ).
    
    STRUKTURA ODPOVĚDI (DODRŽUJ PŘESNĚ):
    1. ZAČNI nadpisem '### STRUČNÉ SHRNUTÍ'. Pokud jsou v datech peníze nebo lhůty, dej je do přehledné Markdown tabulky. Buď extrémně stručný.
    2. PAK nadpis '### PODROBNÉ VYSVĚTLENÍ'. Žádné fráze jako "Na základě vašich dat...". Jdi přímo k věci.
    3. FORMÁT ČÍSEL: Používej tečku jako oddělovač tisíců (např. 10.000 Kč).
    4. VÝPOČET: Pokud se ptají na limit příjmu u levných věcí, spočítej 8x životní minimum (8 * 4.620 Kč = 36.960 Kč).
    5. ZDROJE: Na konci uveď '### KLÍČOVÉ ZDROJE' a max 3 odkazy ve formátu [Název dokumentu](URL).
    6. KONTAKT: info@ligavozic.cz. Zmiň, že mohou do emailu zkopírovat tento chat.
    7. TLAČÍTKA: Na úplný konec napiš '///SUGGESTIONS///' a pod to 3 věcné follow-up otázky na 1 řádek.

    DATA: ${context}
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
