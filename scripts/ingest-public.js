#!/usr/bin/env node
require('dotenv').config();

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');
const { YoutubeTranscript } = require('youtube-transcript');

const config = require('../config');
const { getEmb } = require('../ai-client');

const CONTACT_PHONE_RX = /\+420[\s ]?\d{3}[\s ]?\d{3}[\s ]?\d{3}/;
const CONTACT_EMAIL_RX = /[\w.+-]+@ligavozic\.cz/i;

const SITEMAP_URL = 'https://www.ligavozickaru.cz/sitemap.xml';
const MAIN_HOST = 'www.ligavozickaru.cz';
const AUDIENCE = 'public_web';

const TARGET_CHUNK_SIZE = 800;
const OVERLAP_SIZE = 100;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : null;
const debugIdx = args.indexOf('--debug-page');
const DEBUG_PAGE = debugIdx !== -1 ? args[debugIdx + 1] : null;

const supabase = createClient(config.supabase.url, config.supabase.key);

const SKIP_PATTERNS = [/\/wp-/, /\/feed/, /\/tag\//, /\/author\//, /\/category\//];
const IMAGE_EXT = /\.(jpe?g|png|gif|svg|webp|ico|bmp|tiff?)(\?|$)/i;

function shouldSkipUrl(url) {
  let u;
  try { u = new URL(url); } catch { return true; }
  if (u.host !== MAIN_HOST) return true;
  if (IMAGE_EXT.test(u.pathname)) return true;
  return SKIP_PATTERNS.some(rx => rx.test(u.pathname));
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'liga-ingest/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

async function collectSitemapUrls(sitemapUrl, seen = new Set()) {
  if (seen.has(sitemapUrl)) return [];
  seen.add(sitemapUrl);

  const xml = await fetchText(sitemapUrl);
  const $ = cheerio.load(xml, { xmlMode: true });

  const urls = [];

  const nested = $('sitemap > loc').map((_, el) => $(el).text().trim()).get();
  for (const child of nested) {
    const children = await collectSitemapUrls(child, seen);
    urls.push(...children);
  }

  const direct = $('url > loc').map((_, el) => $(el).text().trim()).get();
  urls.push(...direct);

  return urls;
}

function slugify(text) {
  return (text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

const BLOCK_TAGS = new Set([
  'address','article','aside','blockquote','br','dd','div','dl','dt',
  'fieldset','figcaption','figure','footer','form','h1','h2','h3','h4',
  'h5','h6','header','hr','li','main','nav','ol','p','pre','section',
  'table','tbody','td','tfoot','th','thead','tr','ul'
]);

function extractElementText(el) {
  const parts = [];
  function walk(node) {
    if (!node) return;
    if (node.type === 'text') {
      if (node.data) parts.push(node.data);
      return;
    }
    if (node.type !== 'tag') return;
    const tag = (node.name || '').toLowerCase();
    if (tag === 'script' || tag === 'style') return;
    const isBlock = BLOCK_TAGS.has(tag);
    parts.push(isBlock ? '\n' : ' ');
    for (const c of node.children || []) walk(c);
    if (isBlock) parts.push('\n');
  }
  for (const c of el.children || []) walk(c);
  return parts.join('');
}

function extractBlocks($, root) {
  const blocks = [];
  const $root = $(root);

  $root.find('script, style, nav, header, footer, .menu, #sidebar, noscript, iframe').remove();
  $root.find('*').contents().each(function () {
    if (this.type === 'comment') $(this).remove();
  });

  const selector = 'h1, h2, h3, h4, p, li, blockquote, pre, td';
  $root.find(selector).each((_, el) => {
    const tag = el.tagName.toLowerCase();
    const raw = extractElementText(el);
    const lines = raw.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (lines.length === 0) return;

    if (/^h[1-4]$/.test(tag)) {
      const text = lines.join(' ');
      const id = $(el).attr('id') || slugify(text);
      blocks.push({ type: 'heading', tag, text, anchor: id });
    } else {
      blocks.push({ type: 'text', text: lines.join('\n') });
    }
  });

  return blocks;
}

function isBreadcrumbLine(line) {
  if (/^Domů\s*\/.*$/.test(line)) return true;
  const parts = line.split(/\s*\/\s*/);
  if (parts.length < 2) return false;
  if (!parts.every(p => p.length > 0 && p.length <= 40)) return false;
  if (parts.some(p => /[.!?]$/.test(p))) return false;
  return true;
}

function postProcessBlocks(blocks) {
  const out = [];
  let prevLine = '';
  let pastTopBreadcrumbs = false;

  for (const b of blocks) {
    if (b.type === 'heading') {
      const text = (b.text || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (text.toLowerCase() === prevLine.toLowerCase()) continue;
      out.push({ ...b, text });
      prevLine = text;
      pastTopBreadcrumbs = true;
      continue;
    }
    const rawLines = (b.text || '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const keptLines = [];
    for (const line of rawLines) {
      if (!pastTopBreadcrumbs && isBreadcrumbLine(line)) continue;
      if (line.toLowerCase() === prevLine.toLowerCase()) continue;
      keptLines.push(line);
      prevLine = line;
      pastTopBreadcrumbs = true;
    }
    if (keptLines.length === 0) continue;
    out.push({ type: 'text', text: keptLines.join('\n') });
  }
  return out;
}

function chunkBlocks(blocks, pageUrl) {
  const chunks = [];
  let currentAnchor = null;
  let buffer = '';
  let bufferAnchor = null;

  const flush = () => {
    const content = buffer.trim();
    if (content.length === 0) return;
    const sourceUrl = bufferAnchor ? `${pageUrl}#${bufferAnchor}` : pageUrl;
    chunks.push({ content, source_url: sourceUrl });
    if (content.length > OVERLAP_SIZE) {
      const tail = content.slice(-OVERLAP_SIZE);
      const sliceAt = tail.search(/\s/);
      buffer = (sliceAt >= 0 ? tail.slice(sliceAt + 1) : tail) + ' ';
    } else {
      buffer = '';
    }
    bufferAnchor = currentAnchor;
  };

  for (const block of blocks) {
    if (block.type === 'heading') {
      currentAnchor = block.anchor;
      if (buffer.trim().length === 0) bufferAnchor = currentAnchor;
      const headerLine = block.text + '\n';
      if (buffer.length + headerLine.length > TARGET_CHUNK_SIZE && buffer.trim().length > 0) {
        flush();
        bufferAnchor = currentAnchor;
      }
      buffer += headerLine;
      continue;
    }

    if (buffer.trim().length === 0) bufferAnchor = currentAnchor;

    const piece = block.text + '\n';
    if (buffer.length + piece.length > TARGET_CHUNK_SIZE && buffer.trim().length > 0) {
      flush();
    }
    buffer += piece;
  }

  flush();
  return chunks;
}

function detectContactBlock(text) {
  const lines = text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (!CONTACT_PHONE_RX.test(lines[i])) continue;
    const start = Math.max(0, i - 2);
    const end = Math.min(lines.length, i + 3);
    const window = lines.slice(start, end);
    if (!window.some(l => CONTACT_EMAIL_RX.test(l))) continue;

    const nameStart = Math.max(0, i - 1);
    let candidate = lines.slice(nameStart, Math.min(lines.length, nameStart + 5));
    if (candidate.some(l => CONTACT_PHONE_RX.test(l)) && candidate.some(l => CONTACT_EMAIL_RX.test(l))) {
      return candidate.join('\n');
    }
    return window.slice(0, 5).join('\n');
  }
  return null;
}

function appendContactToChunks(chunks, pageContact) {
  if (!pageContact) return chunks;
  return chunks.map(c => {
    if (c.content.includes(pageContact)) return c;
    return { ...c, content: `${c.content}\nKontakt:\n${pageContact}` };
  });
}

const YT_PATTERNS = [
  /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/g,
  /youtube-nocookie\.com\/embed\/([A-Za-z0-9_-]{11})/g,
  /youtu\.be\/([A-Za-z0-9_-]{11})/g,
  /youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/g
];

function extractYouTubeIds(html) {
  const ids = new Set();
  for (const rx of YT_PATTERNS) {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(html)) !== null) ids.add(m[1]);
  }
  return Array.from(ids);
}

async function fetchVideoTranscript(videoId) {
  try {
    const segs = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'cs' });
    const text = segs.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
    if (text) return { text, status: 'ok' };
  } catch (_) { /* fall through */ }
  try {
    const segs = await YoutubeTranscript.fetchTranscript(videoId);
    const text = segs.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
    return text ? { text, status: 'ok' } : { text: '', status: 'none' };
  } catch (err) {
    return { text: '', status: 'error', error: err.message };
  }
}

function pickRoot($) {
  for (const sel of ['main', 'article', '.entry-content']) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length > 100) return el;
  }
  return $('body');
}

async function processPage(pageUrl) {
  const html = await fetchText(pageUrl);
  const rawHtmlLength = html.length;

  const $body = cheerio.load(html);
  const bodyTextLength = $body('body').text().replace(/\s+/g, ' ').trim().length;

  const videoIds = extractYouTubeIds(html);

  const $ = cheerio.load(html);
  $('script, style, nav, header, footer, .menu, #sidebar, noscript, iframe').remove();

  const title = ($('title').first().text() || $('h1').first().text() || pageUrl).trim();
  const root = pickRoot($);
  const blocks = postProcessBlocks(extractBlocks($, root));
  const cleanedText = blocks.map(b => b.text).join('\n');

  const pageContact = detectContactBlock(cleanedText);

  const allTextChunks = chunkBlocks(blocks, pageUrl);
  const keptTextChunks = allTextChunks.filter(c => c.content.length >= 100);
  const textChunks = appendContactToChunks(
    keptTextChunks.map(c => ({ ...c, document_title: title })),
    pageContact
  );

  const videoResults = [];
  let totalTranscriptChars = 0;
  let transcriptChunks = [];
  for (const videoId of videoIds) {
    const r = await fetchVideoTranscript(videoId);
    totalTranscriptChars += r.text.length;
    videoResults.push({ id: videoId, status: r.status, chars: r.text.length });
    if (r.text) {
      const videoSourceUrl = `${pageUrl}#video-${videoId}`;
      const transBlocks = [{ type: 'text', text: r.text }];
      const rawTrans = chunkBlocks(transBlocks, videoSourceUrl);
      const keptTrans = rawTrans.filter(c => c.content.length >= 100);
      const taggedTrans = appendContactToChunks(
        keptTrans.map(c => ({ ...c, document_title: `${title} (video)` })),
        pageContact
      );
      transcriptChunks = transcriptChunks.concat(taggedTrans);
    }
    if (r.status === 'error') {
      console.warn(`  YouTube transcript error for ${videoId}: ${r.error}`);
    }
  }

  if (videoIds.length > 0) {
    const summary = videoResults.map(v => `${v.id}:${v.status}`).join(', ');
    console.log(`  found ${videoIds.length} YouTube video(s) on ${pageUrl}, transcript: ${summary}`);
  }

  const chunks = textChunks.concat(transcriptChunks);

  return {
    chunks,
    cleanedText,
    dropped: allTextChunks.length - keptTextChunks.length,
    pageContact,
    videoResults,
    rawHtmlLength,
    bodyTextLength,
    totalTranscriptChars,
    textChunkCount: textChunks.length,
    transcriptChunkCount: transcriptChunks.length
  };
}

async function upsertChunks(pageUrl, chunks) {
  const { error: delErrExact } = await supabase
    .from(config.supabase.tableName)
    .delete()
    .eq('source_url', pageUrl)
    .eq('audience', AUDIENCE);
  if (delErrExact) throw delErrExact;

  const { error: delErrAnchor } = await supabase
    .from(config.supabase.tableName)
    .delete()
    .like('source_url', `${pageUrl}#%`)
    .eq('audience', AUDIENCE);
  if (delErrAnchor) throw delErrAnchor;

  if (chunks.length === 0) return;

  const rows = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const embedding = await getEmb(c.content);
    rows.push({
      content: c.content,
      document_title: c.document_title,
      source_url: c.source_url,
      embedding,
      audience: AUDIENCE,
      source: 'web',
      downloads: null,
      chunk_index: i
    });
  }

  const { error: insErr } = await supabase
    .from(config.supabase.tableName)
    .insert(rows);
  if (insErr) throw insErr;
}

async function main() {
  if (!config.supabase.url || !config.supabase.key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  if (!config.google.key) {
    throw new Error('Missing GOOGLE_API_KEY');
  }

  let urls;
  if (DEBUG_PAGE) {
    urls = [DEBUG_PAGE];
    console.log(`[DEBUG-PAGE] Processing single URL: ${DEBUG_PAGE}`);
  } else {
    console.log(`Fetching sitemap: ${SITEMAP_URL}`);
    const allUrls = await collectSitemapUrls(SITEMAP_URL);
    const filtered = Array.from(new Set(allUrls.filter(u => !shouldSkipUrl(u))));
    urls = LIMIT ? filtered.slice(0, LIMIT) : filtered;
    console.log(`URLs in sitemap: ${allUrls.length}, after filter: ${filtered.length}, processing: ${urls.length}`);
  }
  if (DRY_RUN) console.log('[DRY RUN] No DB writes will occur.');

  let totalChunks = 0;
  const collectedForPreview = [];
  const pageStats = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      const r = await processPage(url);
      totalChunks += r.chunks.length;
      console.log(`[${i + 1}/${urls.length}] ${url} → extracted ${r.cleanedText.length} chars → ${r.chunks.length} chunks kept (${r.dropped} dropped <100 chars)`);

      pageStats.push({
        url,
        textChunks: r.textChunkCount,
        transcriptChunks: r.transcriptChunkCount,
        cleanedTextLength: r.cleanedText.length,
        hasContact: !!r.pageContact,
        videoCount: r.videoResults.length,
        transcriptRecovered: r.videoResults.some(v => v.status === 'ok')
      });

      if (DEBUG_PAGE && url === DEBUG_PAGE) {
        console.log(`[DEBUG] raw HTML: ${r.rawHtmlLength} chars | body text: ${r.bodyTextLength} chars | cleaned text: ${r.cleanedText.length} chars | youtube videos: ${r.videoResults.length} | transcript chars: ${r.totalTranscriptChars}`);
        console.log('\n=== EXTRACTED TEXT (first 1500 chars) ===');
        console.log(r.cleanedText.slice(0, 1500));
        console.log('=== EXTRACTED TEXT (first 1500 chars) ===\n');
      }

      if (DRY_RUN) {
        for (const c of r.chunks) collectedForPreview.push(c);
      } else {
        await upsertChunks(url, r.chunks);
      }
    } catch (err) {
      console.error(`[${i + 1}/${urls.length}] ERROR ${url}: ${err.message}`);
    }
  }

  console.log(`\nDone. URLs: ${urls.length}, total chunks: ${totalChunks}`);

  const reviewNeeded = [];
  for (const p of pageStats) {
    if (p.textChunks + p.transcriptChunks === 0) {
      reviewNeeded.push({ url: p.url, reason: '0 chunks produced' });
    }
    if (p.cleanedTextLength < 200 && !p.transcriptRecovered) {
      reviewNeeded.push({ url: p.url, reason: `thin text (${p.cleanedTextLength} chars) and no transcript recovered` });
    }
    if ((/\/sluzby-ligy\//.test(p.url) || /\/poradenstvi-/.test(p.url)) && !p.hasContact) {
      reviewNeeded.push({ url: p.url, reason: 'service page with no contact block detected' });
    }
  }
  if (reviewNeeded.length > 0) {
    console.log('\n=== REVIEW NEEDED ===');
    for (const r of reviewNeeded) console.log(`- ${r.url} → reason: ${r.reason}`);
  }

  if (DRY_RUN && collectedForPreview.length > 0) {
    console.log('\nAll chunks:');
    collectedForPreview.forEach((c, i) => {
      console.log(`\n--- chunk ${i + 1} ---`);
      console.log(`title: ${c.document_title}`);
      console.log(`source_url: ${c.source_url}`);
      console.log(`content (${c.content.length} chars):\n${c.content}`);
    });
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
