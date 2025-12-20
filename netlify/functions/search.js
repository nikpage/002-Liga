const { GoogleGenerativeAI } = require("@google/generative-ai");

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    try {
        const { prompt, type, chatHistory } = JSON.parse(event.body);
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        let finalPrompt = "";

        if (type === "calc") {
            // Generates an actual interactive HTML/JS calculator based on the specific context
            finalPrompt = `Based on this: "${prompt}", create a functional HTML calculator.
            Return ONLY the HTML/JS code. It must calculate specific Czech disability limits.
            No conversational text allowed.`;
        } else if (type === "email") {
            // Summarizes the chat history to prepare a help desk email
            finalPrompt = `Based on this chat: "${chatHistory}", write a professional email draft for a help desk.
            Include the key points from the conversation. Return ONLY the email body.`;
        } else if (type === "step") {
            // FIX: Prevents 502 timeout by limiting response to 5 short steps
            finalPrompt = `Stručně a jasně rozepiš tento postup do 5 očíslovaných bodů.
            Max 2 věty na bod: ${prompt}`;
        } else {
            finalPrompt = `Jsi seniorní poradce Ligy vozíčkářů. Stručně odpověz: ${prompt}`;
        }

        const result = await model.generateContent(finalPrompt);
        const response = await result.response;
        const text = response.text();

        // Standard Netlify return format to prevent gateway errors
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
        };
    } catch (error) {
        // Fallback return to prevent a 502 crash if AI fails
        return { statusCode: 200, body: JSON.stringify({ text: "Chyba: Zkuste to znovu." }) };
    }
};
