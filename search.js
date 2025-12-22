const express = require('express');
const cors = require('cors');
const { getEmb, getAnswer } = require('./src/ai-client');
const { getFullContext } = require('./src/database');
const { formatPrompt } = require('./src/prompts');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/search', async (req, res) => {
  try {
    const { question, history = [], model = "gemini-2.0-flash-lite" } = req.body || {};
    const vector = await getEmb(question);
    const data = await getFullContext(vector, question);
    const prompt = formatPrompt(question, data);
    const aiRes = await getAnswer(model, history, prompt);
    const json = JSON.parse(aiRes.candidates[0].content.parts[0].text);
    res.status(200).json({ answer: `## Stručně\n${json.summary.join('\n')}\n\n## Detail\n${json.detail}`, sources: data.chunks });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server on ${PORT}`));
