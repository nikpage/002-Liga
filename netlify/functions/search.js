const { GoogleGenerativeAI } = require("@google/generative-ai");

exports.handler = async (event) => {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

    try {
        // VERIFIED: Extracting 'question', 'history', and 'type' from the frontend call
        const { question, history, type } = JSON.parse(event.body);
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        let finalPrompt = "";

        if (type === "calc") {
            finalPrompt = `Na základě konverzace: "${JSON.stringify(history)}", vytvoř HTML/JS kalkulačku. Vrať POUZE kód.`;
        } else if (type === "email") {
            finalPrompt = `Na základě historie: "${JSON.stringify(history)}", napiš e-mail pro poradnu. Vrať POUZE text.`;
        } else if (type === "step") {
            finalPrompt = `Rozepiš tento postup do 5 bodů: ${question}`;
        } else {
            finalPrompt = `Jsi seniorní poradce Ligy vozíčkářů. Odpověz na: ${question}. Historie: ${JSON.stringify(history)}`;
        }

        const result = await model.generateContent(finalPrompt);
        const response = await result.response;
        const text = response.text();

        // VERIFIED: Returning the key 'answer' to match frontend expectations
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answer: text })
        };
    } catch (error) {
        return { statusCode: 200, body: JSON.stringify({ answer: "Chyba: Zkuste to znovu." }) };
    }
};
