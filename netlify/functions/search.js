exports.handler = async (event) => {
  console.log("FUNCTION_TRIGGERED"); // This MUST show up in logs

  try {
    const body = JSON.parse(event.body);
    const { query, data } = body;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: `Query: ${query}` }],
        response_format: { type: "json_object" }
      })
    });

    const result = await response.json();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result.choices[0].message.content)
    };
  } catch (err) {
    console.error("CATCH_ERROR:", err.message);
    return {
      statusCode: 200,
      body: JSON.stringify({ error: err.message })
    };
  }
};
