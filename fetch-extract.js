// Fetch a single document by URL and extract its readable text for manual
// ingestion. Handles HTML pages, PDFs, and Word (.docx) files. For HTML it
// strips header/footer/nav/cookie chrome; if the page embeds a captioned
// YouTube video, the captions are pulled in too.
const cheerio = require('cheerio');
const { YoutubeTranscript } = require('youtube-transcript');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

// A clear, user-fixable error (bad URL, empty/scanned file, unreadable file).
// Flagged so the API layer shows the message as-is instead of masking it as a
// generic "technical error, contact support".
function userError(msg) {
    const e = new Error(msg);
    e.userFacing = true;
    return e;
}

function findYouTubeIds(html) {
    const ids = new Set();
    const rx = /(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{11})/g;
    let m;
    while ((m = rx.exec(html)) !== null) ids.add(m[1]);
    return [...ids];
}

// A human-readable title from the URL's last path segment, e.g.
// ".../files/Prirucka_2024.pdf" -> "Prirucka 2024". Used for PDFs/Word docs
// where there's no <title> tag.
function titleFromUrl(url) {
    try {
        const path = new URL(url).pathname;
        const last = decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
        return last.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
    } catch (_) {
        return '';
    }
}

// Decide the document type from the Content-Type header first, then fall back
// to the URL's file extension (some servers send a generic type).
function detectType(contentType, url) {
    const ct = (contentType || '').toLowerCase();
    const path = (() => { try { return new URL(url).pathname.toLowerCase(); } catch (_) { return url.toLowerCase(); } })();
    if (ct.includes('application/pdf') || path.endsWith('.pdf')) return 'pdf';
    if (ct.includes('officedocument.wordprocessingml') ||
        ct.includes('application/msword') ||
        path.endsWith('.docx') || path.endsWith('.doc')) return 'word';
    return 'html';
}

function cleanText(s) {
    return s
        .replace(/[ \t  ]+/g, ' ')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .join('\n');
}

async function extractHtml(html) {
    const $ = cheerio.load(html);
    const title = (
        $('meta[property="og:title"]').attr('content') ||
        $('title').first().text() ||
        $('h1').first().text() ||
        ''
    ).trim();

    // Drop non-content chrome.
    $('script, style, noscript, nav, header, footer, aside, form, iframe, svg').remove();
    $('[role="navigation"], [role="banner"], [role="contentinfo"], .cookie, .cookies, .cookie-bar, .menu, .navbar, .breadcrumb, .breadcrumbs').remove();

    const root = $('main').length ? $('main') : ($('article').length ? $('article') : $('body'));
    const text = cleanText(root.text());

    // Video captions, if any.
    let videoText = '';
    for (const id of findYouTubeIds(html)) {
        try {
            const t = await YoutubeTranscript.fetchTranscript(id);
            const cap = t.map(x => x.text).join(' ').replace(/\s+/g, ' ').trim();
            if (cap) videoText += (videoText ? '\n\n' : '') + cap;
        } catch (e) {
            // No captions available for this video — skip it.
        }
    }
    return { title, text, videoText };
}

async function extractFromUrl(url) {
    if (!/^https?:\/\//i.test(url)) throw userError('Neplatná adresa – odkaz musí začínat „http://" nebo „https://".');

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let res;
    try {
        try {
            res = await fetch(url, {
                signal: ctrl.signal,
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LigaBot/1.0)' }
            });
        } catch (e) {
            if (e.name === 'AbortError') throw userError('Stránka se načítá příliš dlouho (přes 20 s). Zkuste to prosím znovu nebo vložte text ručně.');
            throw userError('Na zadanou adresu se nepodařilo připojit. Zkontrolujte prosím odkaz.');
        }
        if (!res.ok) throw userError(`Stránku se nepodařilo načíst (server odpověděl chybou ${res.status}). Zkontrolujte prosím odkaz.`);

        const type = detectType(res.headers.get('content-type'), url);

        if (type === 'pdf') {
            const buf = Buffer.from(await res.arrayBuffer());
            let parsed;
            try {
                parsed = await pdf(buf);
            } catch (e) {
                throw userError('Tento PDF soubor se nepodařilo přečíst (může být poškozený nebo zaheslovaný).');
            }
            const text = cleanText(parsed.text || '');
            if (!text) throw userError('V tomto PDF není žádný čitelný text – nejspíš jde o naskenovaný dokument (obrázky). Vložte prosím text ručně.');
            const title = ((parsed.info && parsed.info.Title) || '').trim() || titleFromUrl(url);
            return { title, text, videoText: '' };
        }

        if (type === 'word') {
            const buf = Buffer.from(await res.arrayBuffer());
            let value;
            try {
                ({ value } = await mammoth.extractRawText({ buffer: buf }));
            } catch (e) {
                throw userError('Tento dokument Word se nepodařilo přečíst. Podporovány jsou soubory .docx (uložte prosím ve formátu Word, ne starší .doc).');
            }
            const text = cleanText(value || '');
            if (!text) throw userError('V tomto dokumentu se nepodařilo najít žádný text.');
            return { title: titleFromUrl(url), text, videoText: '' };
        }

        const html = await res.text();
        return await extractHtml(html);
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { extractFromUrl };
