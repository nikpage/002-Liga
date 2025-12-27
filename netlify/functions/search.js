exports.handler = async (event) => {
  // 1. Log the start immediately to kill the "silent" aspect
  console.log("Function started. Event body:", event.body);

  try {
    const { query, data } = JSON.parse(event.body);

    // Safety check for data structure
    if (!data || !data.chunks) {
      return {
        statusCode: 200,
        body: JSON.stringify({ strucne: ["No data"], detaily: "Database chunks missing." })
      };
    }

    const ctx = data.chunks.map((c, i) => `[ID ${i+1}] ${c.text}`).join("\n\n");

    // 2. Use native fetch (No axios b*******)
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
    console.log("AI result received.");

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: result.choices[0].message.content
    };

  } catch (error) {
    // 3. Force a log of the error so it isn't silent anymore
    console.error("CRITICAL ERROR:", error);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        strucne: ["System Error"],
        detaily: error.message
      })
    };
  }
};
