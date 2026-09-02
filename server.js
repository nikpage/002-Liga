try {
    require('dotenv').config();
} catch (e) {
    // Railway handles variables natively; this prevents the crash
}

const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { search } = require('./search');
const { getTTS } = require('./ai-client');
const { getQALogs, getAudienceCounts } = require('./database');
const adminChunks = require('./admin-chunks');
const { extractFromUrl } = require('./fetch-extract');

const app = express();

// Railway/Netlify put a proxy in front of us; without this every request looks
// like it comes from the same IP and rate limiting would be meaningless.
app.set('trust proxy', 1);

// Only Liga's own sites may call the API from a browser. Extra origins can be
// added with ALLOWED_ORIGINS (comma-separated) without a code change.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://www.ligavozickaru.cz,https://ligavozickaru.cz,https://ligavozic.cz,https://www.ligavozic.cz')
    .split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);

app.use(cors({
    origin(origin, cb) {
        // No Origin header = same-origin page load, curl, or the server itself.
        if (!origin) return cb(null, true);
        cb(null, ALLOWED_ORIGINS.includes(origin.replace(/\/+$/, '')));
    }
}));
app.use(express.json());

// Only the public front-end files are served. Serving the whole project
// directory would publish source code, SQL and scripts to anyone who asks.
app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

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

// --- Admin login -----------------------------------------------------------
// The admin page and every admin API route require a password, sent by the
// browser as standard HTTP Basic auth. Set ADMIN_PASSWORD in the environment
// (optionally ADMIN_USERNAME, default "admin"). If no password is configured
// the admin side stays closed rather than falling open.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

function safeEqual(a, b) {
    const crypto = require('crypto');
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function requireAdmin(req, res, next) {
    if (!ADMIN_PASSWORD) {
        return res.status(503).json({ error: 'Administrace není nastavena (chybí ADMIN_PASSWORD).' });
    }
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
        const decoded = Buffer.from(encoded, 'base64').toString('utf8');
        const sep = decoded.indexOf(':');
        const user = decoded.slice(0, sep);
        const pass = decoded.slice(sep + 1);
        if (safeEqual(user, ADMIN_USERNAME) && safeEqual(pass, ADMIN_PASSWORD)) return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="Liga admin", charset="UTF-8"');
    res.status(401).json({ error: 'Přihlášení vyžadováno.' });
}

app.use('/api/admin', requireAdmin);

// --- Rate limiting ---------------------------------------------------------
// Simple in-process limiter so an open /search or /tts can't be used to burn
// the AI budget. Counts requests per IP in a rolling window.
function rateLimit({ windowMs, max }) {
    const hits = new Map();
    return (req, res, next) => {
        const now = Date.now();
        const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
        const entry = hits.get(ip);
        if (!entry || now > entry.reset) {
            hits.set(ip, { count: 1, reset: now + windowMs });
        } else if (entry.count >= max) {
            return res.status(429).json({ error: 'Příliš mnoho požadavků, zkuste to prosím za chvíli.' });
        } else {
            entry.count++;
        }
        if (hits.size > 5000) {
            for (const [key, val] of hits) if (now > val.reset) hits.delete(key);
        }
        next();
    };
}

const searchLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });
const ttsLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

// Handles the search request from the frontend
app.post('/search', searchLimiter, async (req, res) => {
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

    // 1b. Strip inline contact-photo <img> tags injected into the answer body
    text = text.replace(/<[^>]+>/g, '');

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
app.get('/admin', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Returns Q&A logs as JSON
app.get('/api/qa-logs', requireAdmin, async (req, res) => {
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
app.get('/api/audiences', requireAdmin, async (req, res) => {
    try {
        res.json(await getAudienceCounts());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Handles TTS requests
app.post('/tts', ttsLimiter, async (req, res) => {
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

// --- Admin Chunks API ---
// Turn any backend error into a plain-Czech message a non-technical user can
// act on, plus a short reference code. The full technical error is logged
// server-side under that code so Nik can trace it.
function adminErrorInfo(e, action) {
    const ref = (Date.now().toString(36) + Math.random().toString(36).slice(2, 5)).slice(-6).toUpperCase();
    console.error(`[ADMIN ${action} ERR ${ref}]`, e && e.stack ? e.stack : e);
    // User-fixable problems (bad URL, scanned/empty file, unreadable file)
    // carry their own clear message — show it as-is, no scary code.
    if (e && e.userFacing) return { userMsg: e.message, ref: null };
    const msg = ((e && e.message) || '').toLowerCase();
    let userMsg;
    if (msg.includes('quota') || msg.includes('429') || msg.includes('resource_exhausted') || msg.includes('rate limit')) {
        userMsg = 'Služba je momentálně přetížená. Zkuste to prosím za minutu znovu.';
    } else if (msg.includes('google') || msg.includes('embedding') || msg.includes('fetch') || msg.includes('network') ||
               msg.includes('timeout') || msg.includes('econn') || msg.includes('socket') ||
               msg.includes('503') || msg.includes('502') || msg.includes('500') || msg.includes('dimension')) {
        userMsg = 'Služba AI je dočasně nedostupná. Zkuste to prosím za chvíli znovu.';
    } else {
        // Unknown failure: surface the real cause (briefly) instead of hiding
        // it, so it can actually be diagnosed without digging through logs.
        const detail = [e && e.code, (e && e.message) || (e && e.details)]
            .filter(Boolean).join(': ').replace(/\s+/g, ' ').slice(0, 180);
        if (detail) {
            // Code is embedded in the message here; suppress the separate ref
            // so the front-end doesn't print it twice.
            return { userMsg: `Došlo k technické chybě: ${detail} (kód: ${ref})`, ref: null };
        }
        userMsg = 'Došlo k technické chybě. Kontaktujte prosím Nika a uveďte kód níže.';
    }
    return { userMsg, ref };
}

function adminError(res, e, action) {
    const { userMsg, ref } = adminErrorInfo(e, action);
    res.status(500).json({ error: userMsg, ref });
}

app.get('/api/admin/chunks', async (req, res) => {
    try {
        const { search, offset, limit, filters, from, to } = req.query;
        const filterArr = filters ? String(filters).split(',').filter(Boolean) : [];
        const result = await adminChunks.listChunks(search, parseInt(offset) || 0, parseInt(limit) || 50, filterArr, { from, to });
        res.json(result);
    } catch (e) { adminError(res, e, 'list'); }
});

// Default browse: most-recently added/changed documents (last 30 days).
app.get('/api/admin/documents/recent', async (req, res) => {
    try {
        const { offset, limit, filters, days, from, to } = req.query;
        const filterArr = filters ? String(filters).split(',').filter(Boolean) : [];
        const result = await adminChunks.listRecentDocuments(parseInt(offset) || 0, parseInt(limit) || 20, filterArr, parseInt(days) || 30, { from, to });
        res.json(result);
    } catch (e) { adminError(res, e, 'recent'); }
});

// Recycle bin: documents deleted in the last 30 days, still recoverable.
app.get('/api/admin/documents/deleted', async (req, res) => {
    try {
        const result = await adminChunks.listDeletedDocuments(parseInt(req.query.days) || 30);
        res.json(result);
    } catch (e) { adminError(res, e, 'deleted'); }
});

app.post('/api/admin/documents/restore', async (req, res) => {
    try {
        const result = await adminChunks.restoreDeletedDocument(req.body.pieces);
        res.json(result);
    } catch (e) { adminError(res, e, 'restore-document'); }
});

app.get('/api/admin/chunks/:id', async (req, res) => {
    try {
        const chunk = await adminChunks.getChunk(req.params.id);
        res.json(chunk);
    } catch (e) { adminError(res, e, 'get'); }
});

app.post('/api/admin/fetch-url', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) { const e = new Error('Zadejte prosím odkaz (URL).'); e.userFacing = true; throw e; }
        const { title, text, videoText } = await extractFromUrl(url);
        const combined = videoText ? `${text}\n\n[Přepis videa]\n${videoText}` : text;
        if (!combined.trim()) { const e = new Error('Na stránce se nepodařilo najít žádný text.'); e.userFacing = true; throw e; }
        res.json({ title, text: combined, chunkCount: adminChunks.countChunks(combined), hasVideo: !!videoText });
    } catch (e) { adminError(res, e, 'fetch-url'); }
});

app.post('/api/admin/documents/delete', async (req, res) => {
    try {
        const result = await adminChunks.deleteDocument(req.body.url);
        res.json(result);
    } catch (e) { adminError(res, e, 'delete-document'); }
});

app.post('/api/admin/chunks/check-url', async (req, res) => {
    try {
        const result = await adminChunks.findByUrl(req.body.url);
        res.json(result);
    } catch (e) { adminError(res, e, 'check-url'); }
});

app.post('/api/admin/chunks/check-replacement', async (req, res) => {
    try {
        const result = await adminChunks.findReplacementCandidate(req.body.content, req.body.source_url);
        res.json(result);
    } catch (e) { adminError(res, e, 'check-replacement'); }
});

app.post('/api/admin/chunks', async (req, res) => {
    try {
        const { replace_url, ...fields } = req.body;
        const sameUrl = replace_url && replace_url === (fields.source_url || '').split('#')[0];
        // Same URL: delete the old copy first, else it would also remove the
        // rows we are about to insert. Different URL: insert first, then drop
        // the old version, so a failed insert never loses the existing doc.
        if (sameUrl) await adminChunks.deleteDocument(replace_url);
        const created = await adminChunks.createChunk(fields);
        if (replace_url && !sameUrl) await adminChunks.deleteDocument(replace_url);
        res.json(created);
    } catch (e) { adminError(res, e, 'create'); }
});

// Streaming create: same as POST /api/admin/chunks but emits live progress
// (chunking + per-piece embedding) over Server-Sent Events so the modal can
// show a real progress counter. X-Accel-Buffering:no keeps proxies (Railway)
// from buffering the stream.
app.post('/api/admin/chunks/stream', async (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    try {
        const { replace_url, ...fields } = req.body;
        const sameUrl = replace_url && replace_url === (fields.source_url || '').split('#')[0];
        // Same URL: delete the old copy first, else it would also remove the
        // rows we are about to insert. Different URL: insert first, then drop
        // the old version, so a failed insert never loses the existing doc.
        if (sameUrl) {
            send({ phase: 'replacing' });
            await adminChunks.deleteDocument(replace_url);
        }
        const created = await adminChunks.createChunk(fields, (p) => send(p));
        if (replace_url && !sameUrl) {
            send({ phase: 'replacing' });
            await adminChunks.deleteDocument(replace_url);
        }
        send({ phase: 'done', count: created.count, replaced: !!replace_url });
    } catch (e) {
        const { userMsg, ref } = adminErrorInfo(e, 'create-stream');
        send({ phase: 'error', error: userMsg, ref });
    } finally {
        res.end();
    }
});

app.put('/api/admin/chunks/:id', async (req, res) => {
    try {
        const chunk = await adminChunks.updateChunk(req.params.id, req.body);
        res.json(chunk);
    } catch (e) { adminError(res, e, 'update'); }
});

app.delete('/api/admin/chunks/:id', async (req, res) => {
    try {
        await adminChunks.deleteChunk(req.params.id);
        res.json({ ok: true });
    } catch (e) { adminError(res, e, 'delete'); }
});

app.get('/api/admin/chunks/:id/history', async (req, res) => {
    try {
        const history = await adminChunks.getHistory(req.params.id);
        res.json(history);
    } catch (e) { adminError(res, e, 'history'); }
});

app.post('/api/admin/chunks/:id/restore/:historyId', async (req, res) => {
    try {
        const chunk = await adminChunks.restoreChunk(req.params.id, req.params.historyId);
        res.json(chunk);
    } catch (e) { adminError(res, e, 'restore'); }
});

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
});

// Daily Facebook ingestion (posts + upcoming events). The script is incremental
// and idempotent — it embeds only new/changed items and exits cheaply when
// there's nothing new — so a daily run is safe. Runs in-process via cron and
// spawns the existing script so all its token/diff logic is reused unchanged.
// Disable with FB_CRON_DISABLED=true; only schedules when a token is available.
(() => {
    if (process.env.FB_CRON_DISABLED === 'true') {
        console.log('FB ingestion cron disabled (FB_CRON_DISABLED=true).');
        return;
    }
    const hasToken = !!process.env.FB_TOKEN || fs.existsSync(path.join(__dirname, 'fb-token.local'));
    if (!hasToken) {
        console.log('FB ingestion cron not scheduled: no FB token (set FB_TOKEN or fb-token.local).');
        return;
    }

    const cron = require('node-cron');
    const { spawn } = require('child_process');
    const SCHEDULE = process.env.FB_CRON_SCHEDULE || '0 5 * * *'; // daily ~05:00 server time
    let running = false;

    const runIngest = () => {
        if (running) { console.log('[fb-cron] previous run still going, skipping this tick.'); return; }
        running = true;
        console.log('[fb-cron] starting Facebook ingestion...');
        const child = spawn(process.execPath, [path.join(__dirname, 'scripts', 'ingest-facebook.js')], {
            cwd: __dirname,
            env: process.env
        });
        child.stdout.on('data', d => process.stdout.write(`[fb-cron] ${d}`));
        child.stderr.on('data', d => process.stderr.write(`[fb-cron] ${d}`));
        child.on('close', code => {
            running = false;
            console.log(`[fb-cron] ingestion finished (exit ${code}).`);
        });
        child.on('error', err => {
            running = false;
            console.error(`[fb-cron] failed to start ingestion: ${err.message}`);
        });
    };

    cron.schedule(SCHEDULE, runIngest);
    console.log(`FB ingestion cron scheduled (${SCHEDULE}).`);
})();
