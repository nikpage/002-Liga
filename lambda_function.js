const neo4j = require("neo4j-driver");

// --- 1. DIRECT SEARCH WITH WEIGHTED LOGIC ---
async function getInsuranceData(driver, question) {
  const session = driver.session();
  try {
    // We use 'OR' logic across the words in the question.
    // This allows the index to find "Mechanický vozík" even if 
    // the user adds other words in the sentence.
    const searchTerms = question.split(/\s+/).filter(w => w.length > 2).join(' OR ');

    const result = await session.run(
      `CALL db.index.fulltext.queryNodes("insuranceSearch", $term) YIELD node, score
       WHERE node.search_text IS NOT NULL AND node.search_text <> ""
       RETURN node.search_text as search_text
       ORDER BY score DESC
       LIMIT 3`,
      { term: searchTerms }
    );
    
    if (result.records.length === 0) return "";
    
    const uniqueLines = [...new Set(result.records
      .map(r => r.get('search_text'))
      .map(text => `INSURANCE DATA (PRIORITY - SOURCE OF TRUTH): ${text}`)
    )];
    
    return uniqueLines.join('\n');
  } catch (e) {
    console.log("Graph search error:", e);
    return "";
  } finally {
    await session.close();
  }
}

// --- MAIN HANDLER ---
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
    // 1. Get Embedding for Vector Search
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

    // 2. Execute Searches
    const [graphData, vectorResult, suppResult, rentalResult] = await Promise.all([
        getInsuranceData(driver, question),
        session.run(`CALL db.index.vector.queryNodes('chunk_vector_index', 10, $vec) YIELD node, score RETURN node.text AS text, node.source AS source`, { vec: qVector }),
        session.run(`CALL db.index.fulltext.queryNodes("supplierSearch", $question) YIELD node RETURN node.name + ' (' + node.city + ')' AS text, node.source AS source LIMIT 3`, { question: question }),
        session.run(`CALL db.index.fulltext.queryNodes("rentalSearch", $question) YIELD node RETURN node.name + ' (' + node.city + ')' AS text, node.source AS source LIMIT 3`, { question: question })
    ]);

    // 3. Build Context
    const contextParts = [];
    const uniqueSources = new Set();

    vectorResult.records.forEach(r => {
        const text = r.get("text");
        const source = r.get("source");
        if (source) { 
            contextParts.push(`ZDROJ (TEXT - SECONDARY): "${source}"\nTEXT: ${text}`); 
            uniqueSources.add(source); 
        } else { 
            contextParts.push(text); 
        }
    });
    
    suppResult.records.forEach(r => contextParts.push("DODAVATEL: " + r.get("text")));
    rentalResult.records.forEach(r => contextParts.push("PŮJČOVNA: " + r.get("text")));

    const context = contextParts.join("\n\n---\n\n");
    const historyBlock = history.map(msg => `${msg.role === 'user' ? 'Uživatel' : 'Asistent'}: ${msg.content}`).join("\n");

    // 4. Final Prompt with Strict Rules
    const prompt = `Jsi asistent. Odpovídej POUZE na základě poskytnutých dat.

    !!! HIERARCHIE PRAVDY (STRICT RULES) !!!
    1. Sekce "INSURANCE DATA (PRIORITY - SOURCE OF TRUTH)" obsahuje přesná data z tabulek.
    2. Pokud tato sekce obsahuje cenu (např. "Cena: 6957 Kč"), MUSÍŠ ji uvést jako jedinou platnou informaci.
    3. Pokud sekce "ZDROJ (TEXT - SECONDARY)" tvrdí, že cena není známa, IGNORUJ TO. Věř pouze prioritním datům.
    4. Pro data z INSURANCE DATA cituj zdroj: [ÚHRADY ZDRAVOTNICKÝCH PROSTŘEDKŮ].

    INSURANCE DATA (PRIORITY - SOURCE OF TRUTH):
    ${graphData}

    DALŠÍ KONTEXT (TEXT - SECONDARY):
    ${context}

    HISTORIE CHATU:
    ${historyBlock}

    OTÁZKA: ${question}
    
    Odpověď:`;

    const genReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const genData = await genReq.json();
    if (genData.error) throw new Error(genData.error.message);

    let rawText = genData.candidates[0].content.parts[0].text;
    
    if (uniqueSources.size > 0) {
        rawText += "\n\n**Zdroje:**";
        uniqueSources.forEach((src) => rawText += `\n- ${src}`);
    }

    return { statusCode: 200, body: JSON.stringify({ answer: rawText }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ answer: "SYSTEM ERROR: " + e.message }) };
  } finally {
    await session.close();
    await driver.close();
  }
};
