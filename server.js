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
const { getQALogs, getAudienceCounts } = require('./database');
const { login: ewayLogin, callMethod: ewayCall } = require('./eway-crm');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Serve widget files with permissive CORS and caching
app.use('/widget', express.static(path.join(__dirname, 'widget'), {
    setHeaders(res) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=3600');
    }
}));

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
    text = text.replace(/^#+ .*$/gm, '');

    // 5. Remove Parentheses and their content completely
    // "word (explanation)" -> "word"
    text = text.replace(/\s*\([^)]*\)/g, '');

    // 6. Remove Czech Legal Entities (s.r.o., z.ú., etc.)
    // Matches patterns like ", s.r.o.", " s. r. o.", ", z.ú."
    // We remove them to make the company names sound natural.
    const legalEntitiesRegex = /(?:,\s*|\s+)(?:s\. ?r\. ?o\.|z\. ?[sú]\.|a\. ?s\.|o\. ?p\. ?s\.|v\. ?o\. ?s\.|k\. ?s\.)/gi;
    text = text.replace(legalEntitiesRegex, '');

    // 7. Remove Bullet points (•, -, *) at start of lines
    text = text.replace(/^[•*-]\s+/gm, '');

    // 8. Remove Emojis (Unicode ranges)
    text = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');

    // 9. Remove remaining raw URLs (e.g. http://...)
    text = text.replace(/https?:\/\/\S+/g, '');

    // 10. Fix Pronunciation for "ligavozic"
    // Force hard 'z' by breaking the 'zi' digraph or using phonetic spelling
    text = text.replace(/ligavozic/gi, 'liga vozic');

    // 11. Cleanup Punctuation and Whitespace
    // Fix double spaces or spaces before punctuation
    text = text.replace(/\s+([,.])/g, '$1');
    // Collapse multiple newlines to avoid long pauses
    text = text.replace(/\n{3,}/g, '\n\n');

    return text.trim();
}

// Serves the admin page for Q&A logs
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Returns Q&A logs as JSON
app.get('/api/qa-logs', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 500, 5000);
        const offset = parseInt(req.query.offset) || 0;
        const result = await getQALogs(limit, offset);
        res.json(result);
    } catch (error) {
        console.error("QA Logs Route Error:", error);
        res.status(500).json({ error: 'Failed to fetch QA logs' });
    }
});

// Diagnostic: lists distinct audience values in the chunks table with counts.
app.get('/api/audiences', async (req, res) => {
    try {
        res.json(await getAudienceCounts());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Diagnostic: tests eWay-CRM login and reports the raw result.
app.get('/api/eway/test', async (req, res) => {
    try {
        const sessionId = await ewayLogin();
        res.json({ ok: true, sessionId });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Diagnostic: dumps all eWay-CRM enum (dropdown) option values.
app.get('/api/eway/enums', async (req, res) => {
    try {
        const enums = await ewayCall('GetEnumValues', {
            transmitObject: {},
            includeForeignKeys: false,
            includeRelations: false
        });
        res.json({ ok: true, enums });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// Diagnostic: dumps eWay-CRM field schema for Journal + SocialServices.
app.get('/api/eway/fields', async (req, res) => {
    try {
        const journal = await ewayCall('GetAdditionalFields', { objectTypeName: 'Journal' });
        const social = await ewayCall('GetAdditionalFields', { objectTypeName: 'SocialServices' });
        res.json({ ok: true, journal, social });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

// One-shot: clears the forced password change by logging in with newPasswordHash.
// Hit ONCE with ?new=<NEW_PASSWORD>, then update EWAY_PASSWORD in Railway to the new value.
app.get('/api/eway/change-password', async (req, res) => {
    try {
        const newPass = req.query.new;
        if (!newPass || newPass.length < 8) {
            return res.status(400).json({ ok: false, error: 'Pass ?new=<password> (min 8 chars).' });
        }
        const crypto = require('crypto');
        const fetch = require('node-fetch');
        const cfg = require('./config').eway;
        if (!cfg.username || !cfg.password) {
            return res.status(500).json({ ok: false, error: 'EWAY_USERNAME or EWAY_PASSWORD not set.' });
        }
        const md5 = s => crypto.createHash('md5').update(s, 'utf8').digest('hex');
        const r = await fetch(cfg.serviceUrl.replace(/\/+$/, '') + '/API.svc/LogIn', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userName: cfg.username,
                passwordHash: md5(cfg.password),
                newPasswordHash: md5(newPass),
                appVersion: 'AV_001',
                clientMachineIdentifier: 'liga-qa-server',
                clientMachineName: 'liga-qa-server'
            })
        });
        const data = await r.json();
        res.json({ httpStatus: r.status, response: data });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

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
