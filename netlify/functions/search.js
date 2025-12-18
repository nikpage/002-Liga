const neo4j = require("neo4j-driver");

exports.handler = async (event) => {
  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS)
  );

  let question, history, selectedModel;
  try {
      const body = JSON.parse(event.body);
      question = body.question;
      history = body.history || [];
      selectedModel = body.model || "gemini-2.5-flash";
  } catch (e) {
      return { statusCode: 400, body: JSON.stringify({ answer: "Invalid JSON" }) };
  }

  const session = driver.session();
  try {
    // 2. EMBED QUESTION (MATCHING INGESTION MODEL)
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

    // 3. SEARCH NEO4J (MATCHING INGESTION INDEX)
    // Note: LangChain Neo4jVector stores text in 'text' and metadata like 'source' directly on the node.
    const result = await session.run(`
      CALL db.index.vector.queryNodes('vector_index', 10, $vec)
      YIELD node, score
      RETURN node.text AS text, node.source AS source, score
      ORDER BY score DESC
    `, { vec: qVector });

    // 4. PROCESS DATA
    const contextParts = [];
    const uniqueSources = new Set();

    result.records.forEach(r => {
        const text = r.get("text");
        const source = r.get("source");
        
        if (source) {
            contextParts.push(`ZDROJ: "${source}"\nTEXT: ${text}`);
            uniqueSources.add(source);
        } else {
            contextParts.push(text);
        }
    });
    const context = contextParts.join("\n\n---\n\n");

    const historyBlock = history.map(msg =>
        `${msg.role === 'user' ? 'Uživatel' : 'Asistent'}: ${msg.content}`
    ).join("\n");

    // 5. GENERATE
    const prompt = `Jsi asistent. Odpověz na otázku podle kontextu.

    INSTRUKCE PRO ODKAZY:
    1. Pokud odpověď vychází z konkrétního souboru, uveď jeho název (např. soubor.pdf).
    2. Používej pouze názvy ze sekcí "ZDROJ:".

    INSTRUKCE PRO NÁVRHY (Next Steps):
    Na úplný konec přidej "///SUGGESTIONS///" a 3 krátké otázky (max 4 slova) vyplývající z NOVÝCH FAKTŮ.
    1. Pokud je to návod -> "Postup krok za krokem".
    2. Pokud je to složité -> "Vysvětli to jednoduše".

    HISTORIE CHATU:
    ${historyBlock}

    NOVÁ FAKTA (KONTEXT):
    ${context}

    AKTUÁLNÍ OTÁZKA UŽIVATELE: ${question}

    Odpověď:`;

    const genReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
        })
    });
    const genData = await genReq.json();

    if (genData.error) throw new Error(genData.error.message);

    let rawText = genData.candidates[0].content.parts[0].text;
    let suggestions = [];

    if (rawText.includes("///SUGGESTIONS///")) {
        const parts = rawText.split("///SUGGESTIONS///");
        rawText = parts[0].trim();
        suggestions = parts[1].split("\n")
            .map(s => s.replace(/^[-\d\.]+\s*/, "").replace(/["']/g, "").trim())
            .filter(s => s.length > 0)
            .slice(0, 3);
    }

    if (uniqueSources.size > 0) {
        rawText += "\n\n**Zdroje:**";
        uniqueSources.forEach((src) => {
            rawText += `\n- ${src}`;
        });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
          answer: rawText,
          suggestions: suggestions
      })
    };

  } catch (e) {
    console.error(e);
    return { statusCode: 200, body: JSON.stringify({ answer: "SYSTEM ERROR: " + e.message }) };
  } finally {
    await session.close();
    await driver.close();
  }
};
