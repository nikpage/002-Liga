#!/usr/bin/env node
// Ingest Liga's Facebook posts into the `chunks` table (AI knowledge base).
// Mirrors scripts/ingest-public.js: embed via Google getEmb (1536d) -> upsert into Supabase.
//
// Usage:  node scripts/ingest-facebook.js            (reads token from fb-token.local or FB_TOKEN)
//         node scripts/ingest-facebook.js --dry-run  (no DB writes, prints what would be ingested)
//
// Needs in .env (same as the site ingest): GOOGLE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
require('dotenv').config();

const fetch = require('node-fetch');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const { getEmb } = require('../ai-client');

const GRAPH = 'https://graph.facebook.com/v21.0';
const AUDIENCE = 'public_web';      // Liga's own posts are public
const SOURCE = 'facebook';          // lets us rebuild only FB rows without touching the website rows
const MIN_CHARS = 100;              // drop thin posts (same threshold as the site ingest)
const HIGHLIGHT_DAYS = 30;          // "NEW" window for service announcements

const DRY_RUN = process.argv.includes('--dry-run');

function loadToken() {
  if (process.env.FB_TOKEN) return process.env.FB_TOKEN.trim();
  if (fs.existsSync('fb-token.local')) {
    const t = fs.readFileSync('fb-token.local', 'utf8').trim();
    if (t) return t;
  }
  // Fallback: pull the token out of fb-run-command.txt (FB_TOKEN=...).
  if (fs.existsSync('fb-run-command.txt')) {
    const m = fs.readFileSync('fb-run-command.txt', 'utf8').match(/FB_TOKEN=(\S+)/);
    if (m && m[1] && m[1] !== 'PASTE_YOUR_TOKEN_HERE') return m[1];
  }
  return null;
}
let TOKEN = loadToken();
if (!TOKEN) { console.error('Missing token. Put it in fb-token.local or set FB_TOKEN.'); process.exit(1); }

const supabase = createClient(config.supabase.url, config.supabase.key);

// Posts we deliberately exclude (joke videos with the same caption — value is in the video, not text).
const SKIP_PATTERNS = [/S úsměvem to jede líp/i];
// Heuristic: posts announcing a new service get the temporary "NEW" highlight.
const SERVICE_PATTERNS = [/nová služba/i, /přichází s novou/i, /nový projekt/i, /spouštíme/i];

async function getJson(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}
function build(path, params = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  url.searchParams.set('access_token', TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

async function resolvePage() {
  // fb-token.local holds a permanent PAGE token, so /me is the page itself.
  // (Fall back to me/accounts in case a user token is ever used instead.)
  try {
    const me = await getJson(build('me', { fields: 'id,name' }));
    if (me.id) { console.log(`Page: ${me.name} (${me.id})`); return me; }
  } catch (_) { /* not a page token, try user token path */ }

  const acc = await getJson(build('me/accounts', { fields: 'id,name,access_token' }));
  if (!acc.data || !acc.data.length) throw new Error('No managed pages found.');
  let page = acc.data[0];
  if (process.env.PAGE_ID) page = acc.data.find(p => p.id === process.env.PAGE_ID) || page;
  if (page.access_token) TOKEN = page.access_token;
  console.log(`Page: ${page.name} (${page.id})`);
  return page;
}

async function getAllPosts(pageId) {
  const posts = [];
  let url = build(`${pageId}/posts`, {
    fields: 'id,created_time,message,permalink_url',
    limit: '100'
  });
  while (url) {
    const page = await getJson(url);
    for (const p of page.data || []) posts.push(p);
    process.stdout.write(`\r  listed ${posts.length} posts...`);
    url = page.paging && page.paging.next ? page.paging.next : null;
  }
  process.stdout.write('\n');
  return posts;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// getEmb but resilient to Google's rate limit (429 / resource exhausted): back off and retry.
async function embed(text) {
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      return await getEmb(text);
    } catch (e) {
      if (/exhaust|quota|rate|429/i.test(e.message) && attempt < 6) {
        const wait = 5000 * (attempt + 1); // 5s,10s,15s... lets the per-minute quota refill
        process.stdout.write(`\r  rate limited, waiting ${wait / 1000}s...        `);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

function keep(post) {
  const text = (post.message || '').trim();
  if (text.length < MIN_CHARS) return false;                 // no-text + thin posts
  if (SKIP_PATTERNS.some(rx => rx.test(text))) return false; // joke videos
  return true;
}

function isService(text) {
  return SERVICE_PATTERNS.some(rx => rx.test(text));
}

async function main() {
  if (!config.supabase.url || !config.supabase.key) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  if (!config.google.key) throw new Error('Missing GOOGLE_API_KEY');

  const page = await resolvePage();
  const all = await getAllPosts(page.id);
  const kept = all.filter(keep);
  // de-dupe identical captions (reposts) — keep the most recent
  const seen = new Set();
  const unique = [];
  for (const p of kept) {
    const key = (p.message || '').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }

  console.log(`Posts: ${all.length} total -> ${kept.length} after filter -> ${unique.length} after de-dupe`);

  const rows = [];
  for (let i = 0; i < unique.length; i++) {
    const p = unique[i];
    const text = p.message.trim();
    const createdISO = p.created_time;                 // event_date = when it was posted
    const highlight = isService(text)
      ? new Date(new Date(createdISO).getTime() + HIGHLIGHT_DAYS * 86400000).toISOString()
      : null;

    rows.push({
      content: text,
      document_title: `Liga vozíčkářů – Facebook (${createdISO.slice(0, 10)})`,
      source_url: p.permalink_url || `https://facebook.com/${p.id}`,
      audience: AUDIENCE,
      source: SOURCE,
      chunk_index: 0,
      event_date: createdISO,
      highlight_until: highlight,
      downloads: null,
      embedding: DRY_RUN ? null : await embed(text)
    });
    if (!DRY_RUN) await sleep(120); // gentle pacing to avoid hammering the quota
    process.stdout.write(`\r  prepared ${i + 1}/${unique.length}...`);
  }
  process.stdout.write('\n');

  if (DRY_RUN) {
    console.log('\n[DRY RUN] would ingest these (no DB writes):');
    rows.slice(0, 10).forEach(r => console.log(`- ${r.document_title}${r.highlight_until ? ' [NEW]' : ''}: ${r.content.slice(0, 80)}...`));
    console.log(`...and ${Math.max(0, rows.length - 10)} more. Total: ${rows.length}`);
    return;
  }

  // Rebuild only the Facebook rows: delete then insert. Never touches website/eway rows.
  const { error: delErr } = await supabase.from('chunks').delete().eq('source', SOURCE);
  if (delErr) throw delErr;

  // Insert in batches so the DB doesn't time out on one huge statement.
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error: insErr } = await supabase.from('chunks').insert(slice);
    if (insErr) throw insErr;
    process.stdout.write(`\r  inserted ${Math.min(i + BATCH, rows.length)}/${rows.length}...`);
  }

  console.log(`\nIngested ${rows.length} Facebook posts into chunks (source='${SOURCE}').`);
}

main().catch(err => { console.error('\nERROR:', err.message); process.exit(1); });
