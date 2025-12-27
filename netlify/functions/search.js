const axios = require('axios');

exports.handler = async (event) => {
  // Use AbortController to kill the request before Netlify kills the function
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8500);

  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const { query, data } = JSON.parse(event.body);

    // CRASH PROTECTION: If data is missing, return a clean 200 instead of a 500
    if (!data || !data.chunks || data.chunks.length === 0) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strucne: ["No data available"],
          detaily: "The database returned no relevant information for this query.",
          vice_informaci: "Please try a different search term.",
          pouzite_zdroje: []
        })
      };
    }

    const ctx = data.chunks.map((c, i) => `[ID ${i+1}] ${c.text}`).join("\n\n");
    const prompt = `Return ONLY JSON. Query: ${query}\n\nContext:\n${ctx}`;

    // API CALL WITH TIMEOUT
    const aiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    }, {
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: controller.signal // Connects the timeout
    });

    clearTimeout(timeoutId);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: aiResponse.data.choices[0].message.content
    };

  } catch (error) {
    // PREVENTS THE 500/502 CRASH
    console.error("Caught Error:", error.message);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        strucne: ["System Timeout or Error"],
        detaily: "The request took too long or the AI failed to respond.",
        vice_informaci: `Error Details: ${error.message}`,
        pouzite_zdroje: []
      })
    };
  }
};
