require("dotenv").config();
// server.js - The Brain
const express = require("express");
const neo4j = require("neo4j-driver");
const cors = require("cors");
const app = express();

app.use(express.json());
app.use(cors()); 

// DATABASE CONNECTION
// NOTE: dotenv is NOT used here; process.env is read directly by Node/Express.
const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS)
);

app.post("/search", async (req, res) => {
  const { question, history, model } = req.body;
  // Default to 2.5 Flash if nothing is selected
  const selectedModel = model || "gemini-2.5-flash"; 

  const session = driver.session();
  try {
    // 1. EMBED
    // We must use fetch instead of the outdated @google/generative-ai SDK version 0.24.1
    const embReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: "models/text-embedding-004",
            content: { parts: [{ text: question }] }
        })
    });
    const embData = await embReq.json();
    if (!embData.embedding) throw new Error("Embedding failed. Check API Key/Quota.");
    const qVector = embData.embedding.values;

    // 2. SEARCH NEO4J
    const result = await session.run(`
      CALL db.index.vector.queryNodes('document_vector_index', 10, $vec)
      YIELD node, score
      RETURN node.text AS text, score
      ORDER BY score DESC
    `, { vec: qVector });

    const context = result.records.map(r => r.get("text")).join("\n\n");

    // 3. HISTORY
    const historyBlock = (history || []).map(msg => 
        `${msg.role === 'user' ? 'Uživatel' : 'Asistent'}: ${msg.content}`
    ).join("\n");

    // 4. GENERATE (Using the chosen model)
    const prompt = `Jsi asistent. Odpověz na otázku podle kontextu a historie chatu.
    HISTORIE: ${historyBlock}
    KONTEXT: ${context}
    OTÁZKA: ${question}
    Odpověď:`;

    // Dynamic URL for Model Selection
    const genReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    
    const genData = await genReq.json();
    
    if (genData.error) {
        return res.status(500).json({ answer: "GOOGLE ERROR: " + genData.error.message });
    }

    const answer = genData.candidates[0].content.parts[0].text;
    res.json({ answer });

  } catch (e) {
    console.error(e);
    res.status(500).json({ answer: "SERVER ERROR: " + e.message });
  } finally {
    await session.close();
  }
});

// START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
