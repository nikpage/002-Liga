const functions = require('@google-cloud/functions-framework');
const { getEmb, getAnswer } = require('./src/ai-client');
const { getFullContext } = require('./src/database');
const { formatPrompt } = require('./src/prompts');

functions.http('search', async (req, res) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' });
  if (req.method === "OPTIONS") return res.status(204).send('');
  try {
    const { question, history = [], model = "gemini-2.0-flash-lite" } = req.body || {};
    const vector = await getEmb(question);
    const data = await getFullContext(vector, question);
    const prompt = formatPrompt(question, data);
    const aiRes = await getAnswer(model, history, prompt);
    const json = JSON.parse(aiRes.candidates[0].content.parts[0].text);
    res.status(200).json({ 
      answer: `## Stručně\n${json.summary.join('\n')}\n\n## Detail\n${json.detail}`, 
      sources: data.chunks 
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
