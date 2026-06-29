// Fetch a single web page and extract its readable text for manual ingestion.
// Strips header/footer/nav/cookie chrome; if the page embeds a captioned
// YouTube video, the captions are pulled in too.
const cheerio = require('cheerio');
const { YoutubeTranscript } = require('youtube-transcript');

function findYouTubeIds(html) {
    const ids = new Set();
    const rx = /(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([A-Za-z0-9_-]{11})/g;
    let m;
    while ((m = rx.exec(html)) !== null) ids.add(m[1]);
    return [...ids];
}

async function extractFromUrl(url) {
    if (!/^https?:\/\//i.test(url)) throw new Error('Neplatná URL – musí začínat http(s)://.');

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let html;
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LigaBot/1.0)' }
        });
        if (!res.ok) throw new Error(`Stránku se nepodařilo načíst (HTTP ${res.status}).`);
        html = await res.text();
    } finally {
        clearTimeout(timer);
    }

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
    const text = root.text()
        .replace(/[ \t ]+/g, ' ')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .join('\n');

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

module.exports = { extractFromUrl };
