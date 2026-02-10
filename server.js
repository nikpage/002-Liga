try {
    require('dotenv').config();
} catch (e) {
    // Railway handles variables natively; this prevents the crash
}

const express = require('express');
const path = require('path');
const cors = require('cors');
const { search } = require('./search');
const { getTTS } = require('./ai-client');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Serves the index.html file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Handles the search request from the frontend
app.post('/search', async (req, res) => {
    try {
        const result = await search(req.body);
        res.json(result);
    } catch (error) {
        console.error("Route Error:", error);
        res.status(500).json({ error: 'Search failed' });
    }
});

/**
 * Cleans Markdown text for Text-to-Speech.
 * Removes emojis, source lists, download lists, and formatting.
 */
function cleanTextForTTS(text) {
    if (!text) return "";

    // 1. Remove the "Sources" and "Downloads" sections added by search.js
    const footerRegex = /\n\n---\n# (?:📄 Zdroje|📥 Ke stažení)[\s\S]*$/;
    text = text.replace(footerRegex, '');

    // 2. Remove Markdown Links [Text](URL) -> Text
    text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

    // 3. Remove Bold/Italic (**text**, *text*, __text__)
    text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
    text = text.replace(/(\*|_)(.*?)\1/g, '$2');

    // 4. Remove Headers completely (# Header)
    // Removes the entire line containing the header
    text = text.replace(/^#+ .*$/gm, '');

    // 5. Remove Parentheses and their content completely
    // "word (explanation)" -> "word"
    text = text.replace(/\s*\([^)]*\)/g, '');

    // 6. Remove Bullet points (•, -, *) at start of lines
    text = text.replace(/^[•*-]\s+/gm, '');

    // 7. Remove Emojis (Unicode ranges)
    text = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');

    // 8. Remove remaining raw URLs (e.g. http://...)
    text = text.replace(/https?:\/\/\S+/g, '');

    // 9. Fix Pronunciation for "ligavozic"
    // Force hard 'z' by breaking the 'zi' digraph or using phonetic spelling
    text = text.replace(/ligavozic/gi, 'liga vozic');

    // 10. Cleanup Punctuation and Whitespace
    // Fix double spaces or spaces before punctuation
    text = text.replace(/\s+([,.])/g, '$1');
    // Collapse multiple newlines to avoid long pauses
    text = text.replace(/\n{3,}/g, '\n\n');

    return text.trim();
}

// Handles TTS requests
app.post('/tts', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: 'No text provided' });

        // Clean the text specifically for audio output
        const cleanedText = cleanTextForTTS(text);

        // Limit text length to prevent huge costs/latency
        const safeText = cleanedText.substring(0, 5000);

        if (safeText.length === 0) {
            return res.status(400).json({ error: 'Text is empty after cleaning' });
        }

        const audioBuffer = await getTTS(safeText);

        res.set({
            'Content-Type': 'audio/mpeg',
            'Content-Length': audioBuffer.length
        });
        res.send(audioBuffer);
    } catch (error) {
        console.error("TTS Route Error:", error);
        res.status(500).json({ error: 'TTS generation failed' });
    }
});

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
});
