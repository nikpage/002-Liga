exports.handler = async (event) => {
  try {
    const { query, data } = JSON.parse(event.body);
    const ctx = data.chunks.map((c, i) => `[ID ${i+1}] ${c.text}`).join("\n\n");

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: `Context: ${ctx}\n\nQuery: ${query}` }],
        response_format: { type: "json_object" }
      })
    });

    const result = await response.json();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: result.choices[0].message.content
    };
  } catch (err) {
    return {
      statusCode: 200,
      body: JSON.stringify({ error: err.message })
    };
  }
};
