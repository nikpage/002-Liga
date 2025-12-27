exports.handler = async (event) => {
  try {
    // 1. Parse the request from your frontend
    const { query, data } = JSON.parse(event.body);

    // 2. Prepare the data for the AI
    const ctx = data.chunks.map((c, i) => `[ID ${i+1}] ${c.text}`).join("\n\n");

    // 3. Use the built-in 'fetch' (No axios, no installation needed)
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "Return ONLY valid JSON." },
          { role: "user", content: `Context:\n${ctx}\n\nQuestion: ${query}` }
        ],
        response_format: { type: "json_object" }
      })
    });

    const result = await response.json();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: result.choices[0].message.content
    };

  } catch (error) {
    // 4. Global safety net to keep the site from going down
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        strucne: ["Error"],
        detaily: error.message,
        vice_informaci: "Check your OPENAI_API_KEY in Netlify settings.",
        pouzite_zdroje: []
      })
    };
  }
};
