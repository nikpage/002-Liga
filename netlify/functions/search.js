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

    const result = await session.run(`
      CALL db.index.vector.queryNodes('chunk_vector_index', 10, $vec)
      YIELD node, score
      RETURN node.text AS text, node['id:ID'] AS source, score
      ORDER BY score DESC
    `, { vec: qVector });

    const equipmentResult = await session.run(`
      MATCH (e:Equipment)-[:HAS_VARIANT]->(v:EquipmentVariant)
      OPTIONAL MATCH (v)-[:CAN_BE_PRESCRIBED_BY]->(d:DoctorSpecialization)
      WITH v, e, collect(DISTINCT d.name) AS doctors
      RETURN e.name + ' - ' + v.variant_name AS equipment,
             v.coverage_czk_without_dph AS price,
             v.doba_uziti AS doba_uziti,
             v.circulation AS circulation,
             doctors,
             'equipment-' + v.id AS source
      LIMIT 10
    `);

    const rentalResult = await session.run(`
      MATCH (r:Rental)
      RETURN r.name + ' (' + r.city + ')' AS text, r.source AS source
      LIMIT 10
    `);

    const orgResult = await session.run(`
      MATCH (o:Organization)
      RETURN o.name + ' (' + o.location + ')' AS text, o.source AS source
      LIMIT 10
    `);

    const contextParts = [];
    const uniqueSources = new Set();

    result.records.forEach(r => {
        const text = r.get("text");
        const source = r.get("source");
        if (text && source) {
            contextParts.push(text);
            uniqueSources.add(source);
        }
    });

    equipmentResult.records.forEach(r => {
        const equipment = r.get("equipment");
        const price = r.get("price");
        const doba = r.get("doba_uziti");
        const circulation = r.get("circulation");
        const doctors = r.get("doctors");
        const source = r.get("source");

        let equipText = `${equipment}: Cena ${price} Kč (úhrada pojišťovny), Doba užití: ${doba}`;
        if (doctors && doctors.length > 0) {
            equipText += `, Předepisuje: ${doctors.join(', ')}`;
        }
        equipText += `, ${circulation ? 'Vrací se pojišťovně' : 'Nevrací se'}`;

        contextParts.push(equipText);
        uniqueSources.add(source);
    });

    rentalResult.records.forEach(r => {
        const text = r.get("text");
        const source = r.get("source");
        if (text && source) {
            contextParts.push(text);
            uniqueSources.add(source);
        }
    });

    orgResult.records.forEach(r => {
        const text = r.get("text");
        const source = r.get("source");
        if (text && source) {
            contextParts.push(text);
            uniqueSources.add(source);
        }
    });

    const context = contextParts.join("\n\n");

    const historyBlock = history.map(msg =>
        `${msg.role === 'user' ? 'Uživatel' : 'Asistent'}: ${msg.content}`
    ).join("\n");

    const prompt = `Odpověz PŘESNĚ na otázku. Pokud máš konkrétní data (ceny, místa, jména), VŽDY je prioritně použij místo obecných informací.

HISTORIE:
${historyBlock}

DATA:
${context}

OTÁZKA: ${question}

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
      body: JSON.stringify({ answer: rawText, suggestions: suggestions })
    };

  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ answer: "SYSTEM ERROR: " + e.message }) };
  } finally {
    await session.close();
    await driver.close();
  }
};
