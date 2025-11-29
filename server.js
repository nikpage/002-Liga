const express = require('express');
const cors = require('cors');
const neo4j = require('neo4j-driver');
require('dotenv').config(); // Load env vars if testing locally

const app = express();
app.use(cors()); //CX: ALLOWS CONNECTION FROM FRONTEND
app.use(express.json());

// Initialize Driver ONCE (do not close it per request)
const driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASS)
);

app.post('/search', async (req, res) => {
    // 1. PARSE INPUT (Req.body instead of event.body)
    const { question, history = [], model } = req.body;
    const selectedModel = model || "gemini-2.5-flash";

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
            `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
        ).join("\n");

        // 5. GENERATE
        const prompt = `You are a helpful assistant. Answer based on context and history.

        HISTORY:
        ${historyBlock}

        CONTEXT:
        ${context}

        QUESTION: ${question}

        ANSWER:`;

        const genReq = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${process.env.GOOGLE_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const genData = await genReq.json();

        if (genData.error) throw new Error(genData.error.message);
        const answer = genData.candidates[0].content.parts[0].text;

        res.json({ answer: answer });

    } catch (e) {
        console.error(e);
        res.status(500).json({ answer: "SYSTEM ERROR: " + e.message });
    } finally {
        await session.close();
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
