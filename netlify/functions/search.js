const neo4j = require("neo4j-driver");

exports.handler = async (event) => {
  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS)
  );

  // 1. PARSE INPUT
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
    // 2. EMBED QUESTION
    const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: "models/text-embedding-004",
            content: { parts: [{ text: question }] }
        })
    });
    const embData = await embReq.json();
    const qVector = embData.embedding.values;

    // 3. SEARCH NEO4J
    const result = await session.run(`
      CALL db.index.vector.queryNodes('chunk_vector_index', 10, $vec)
      YIELD node, score
      MATCH (node)-[:PART_OF]->(d:Document)
      RETURN node.text AS text, d.title AS title, d.url AS url, score
      ORDER BY score DESC
    `, { vec: qVector });

    // 4. PROCESS DATA
    const contextParts = [];
    const uniqueSources = new Map();

    result.records.forEach(r => {
        const title = r.get("title");
        const url = r.get("url");
        if (title) {
            contextParts.push(`ZDROJ: "${title}"\nTEXT: ${r.get("text")}`);
            if (url) uniqueSources.set(url, title);
        } else {
            contextParts.push(r.get("text"));
        }
    });
    const context = contextParts.join("\n\n---\n\n");

    const historyBlock = history.map(msg =>
        `${msg.role === 'user' ? 'Uživatel' : 'Asistent'}: ${msg.content}`
    ).join("\n");

    // 5. GENERATE (STRICTER PROMPT)
    const prompt = `Jsi asistent. Odpověz na otázku podle kontextu.

    INSTRUKCE PRO ODKAZY:
    1. Pokud odpověď zmiňuje konkrétní formulář, šablonu nebo dokument, uveď jeho název v závorce přímo v textu (viz: Název).
    2. Používej pouze názvy uvedené v sekcích "ZDROJ:".

    INSTRUKCE PRO NÁVRHY (Next Steps):
    Na úplný konec odpovědi přidej sekci "///SUGGESTIONS///" a pod ni vypiš 3 velmi krátké (max 4 slova) otázky.
    PRAVIDLA PRO NÁVRHY:
    1. Navrhuj POUZE otázky, na které lze najít odpověď v sekci "NOVÁ FAKTA". Nevymýšlej si témata mimo kontext.
    2. Pokud text popisuje proces nebo návod, jeden z návrhů MUSÍ být: "Postup krok za krokem".
    3. Pokud text je složitý, navrhni: "Vysvětli to jednoduše".

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

    // 6. PARSE SUGGESTIONS
    if (rawText.includes("///SUGGESTIONS///")) {
        const parts = rawText.split("///SUGGESTIONS///");
        rawText = parts[0].trim();

        suggestions = parts[1].split("\n")
            .map(s => s.replace(/^[-\d\.]+\s*/, "").replace(/["']/g, "").trim()) // Clean up numbering and quotes
            .filter(s => s.length > 0)
            .slice(0, 3);
    }

    // 7. APPEND LINKS
    if (uniqueSources.size > 0) {
        rawText += "\n\n**Zdroje:**";
        uniqueSources.forEach((title, url) => {
            rawText += `\n- [${title}](${url})`;
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
