const { getEmb, getAnswer } = require('./ai-client');
const { getFullContext } = require('./database');
const { google: cfg } = require('./config');

function buildExtractionPrompt(query, data) {
  const chunks = (data && data.chunks) ? data.chunks : [];
  const ctx = chunks.map((c, i) => {
    let content = c.text;
    try {
      const parsed = JSON.parse(content);
      if (parsed.entity && parsed.municipality) {
        let readable = `Organizace: ${parsed.entity}, Místo: ${parsed.municipality}`;
        if (parsed.features && Array.isArray(parsed.features)) {
          readable += `, Pomůcky: ${parsed.features.join(', ')}`;
        }
        if (parsed.address) readable += `, Adresa: ${parsed.address}`;
        if (parsed.phone) readable += `, Telefon: ${parsed.phone}`;
        if (parsed.email) readable += `, Email: ${parsed.email}`;
        if (parsed.note) readable += `, Poznámka: ${parsed.note}`;
        content = readable;
      }
    } catch (e) {}
    return `[Source ${i+1}] Title: ${c.title} | URL: ${c.url || 'No URL'} | Content: ${content}`;
  }).join("\n\n");

  return `You are a world-class legal and social advisor for Liga Vozíčkářů. Provide expert response in Czech.

RULES:
- Extract concrete facts: organization names, doctor types, amounts (Kč), timeframes, contacts
- Use simple Czech, short sentences
- For "how to" questions, use NUMBERED STEPS
- Use ONLY provided context

CONTEXT:
${ctx}

USER QUESTION: ${query}

OUTPUT JSON:
{
  "strucne": "Brief answer in Czech",
  "detaily": "Detailed answer with ALL facts from context - organizations, contacts, steps",
  "pouzite_zdroje": [{"index": 1, "title": "...", "url": "...", "duvod": "..."}]
}`;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const { query } = JSON.parse(event.body);

    const vector = await getEmb(query);
    const data = await getFullContext(vector, query);

    const extractPrompt = buildExtractionPrompt(query, data);
    const extractResponse = await getAnswer(cfg.chatModel, [], extractPrompt);
    const extractContent = extractResponse.candidates[0].content.parts[0].text;

    const result = JSON.parse(extractContent.replace(/```json/g, "").replace(/```/g, "").trim());

    const uniqueSources = [];
    const seenUrls = new Set();
    if (result.pouzite_zdroje) {
      result.pouzite_zdroje.forEach(source => {
        if (source.url && !seenUrls.has(source.url)) {
          seenUrls.add(source.url);
          uniqueSources.push({ titulek: source.title, url: source.url });
        }
      });
    }

    const strucne = result.strucne || "Bohužel nemám konkrétní informace.";
    let formattedResponse = `### 💡 Stručné shrnutí\n${strucne}\n\n`;

    if (result.detaily && result.detaily.length > 5) {
      formattedResponse += `### 📝 Podrobnosti\n${result.detaily}\n\n`;
    }

    if (uniqueSources.length > 0) {
      formattedResponse += `---\n### 📄 Použité zdroje\n`;
      uniqueSources.forEach(s => {
        formattedResponse += `- [${s.titulek}](${s.url})\n`;
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        answer: formattedResponse,
        metadata: { sources: uniqueSources }
      })
    };

  } catch (err) {
    console.error("Function failed:", err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ answer: "Chyba: " + err.message })
    };
  }
};
