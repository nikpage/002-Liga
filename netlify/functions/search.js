const neo4j = require("neo4j-driver");

exports.handler = async (event) => {
  const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS)
  );

  // 1. PARSE INPUT (Now accepts model choice)
  let question, history, selectedModel;
  try {
      const body = JSON.parse(event.body);
      question = body.question;
      history = body.history || [];
      // Default to 2.5 Flash if nothing is selected
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
      CALL db.index.vector.queryNodes('document_vector_index', 10, $vec)
      YIELD node, score
      RETURN node.text AS text, score
      ORDER BY score DESC
    `, { vec: qVector });

    const context = result.records.map(r => r.get("text")).join("\n\n");

    // 4. PREPARE HISTORY
    const historyBlock = history.map(msg =>
        `${msg.role === 'user' ? 'Uživatel' : 'Asistent'}: ${msg.content}`
    ).join("\n");

    // 5. GENERATE (Using the SELECTED Model)
    const prompt = `Jsi asistent. Odpověz na otázku podle kontextu a historie chatu.

    HISTORIE CHATU:
    ${historyBlock}

    NOVÁ FAKTA (KONTEXT):
    ${context}

    AKTUÁLNÍ OTÁZKA UŽIVATELE: ${question}

    Odpověď:`;

    // Dynamic URL based on selectedModel variable
    const genReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
        })
    });
    const genData = await genReq.json();

    if (genData.error) throw new Error(genData.error.message);
    const answer = genData.candidates[0].content.parts[0].text;

    return {
      statusCode: 200,
      body: JSON.stringify({ answer: answer })
    };

  } catch (e) {
    console.error(e);
    return { statusCode: 200, body: JSON.stringify({ answer: "SYSTEM ERROR: " + e.message }) };
  } finally {
    await session.close();
    await driver.close();
  }
};
