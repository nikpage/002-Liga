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

// Handles TTS requests
app.post('/tts', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: 'No text provided' });

        // Limit text length to prevent huge costs/latency
        const safeText = text.substring(0, 5000);

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
