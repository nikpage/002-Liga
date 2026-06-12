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

// Liga's Facebook Events — the authoritative source of advertised event dates
// (the marketing posts rarely state the date in text; the Event object does).
async function getAllEvents(pageId) {
  const events = [];
  let url = build(`${pageId}/events`, {
    fields: 'id,name,description,start_time,end_time,place{name,location{street,city}}',
    limit: '100'
  });
  while (url) {
    const page = await getJson(url);
    for (const e of page.data || []) events.push(e);
    url = page.paging && page.paging.next ? page.paging.next : null;
  }
  return events;
}

const CZ_WEEKDAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];

// Formats a Graph start_time ("2026-09-19T14:00:00+0200") as Czech wall-clock,
// reading the components straight from the string so the displayed time matches
// the event's own timezone (no UTC shifting).
function formatCz(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return String(iso);
  const [, y, mo, d, hh, mm] = m;
  const weekday = CZ_WEEKDAYS[new Date(Date.UTC(+y, +mo - 1, +d)).getUTCDay()];
  return `${weekday} ${+d}. ${+mo}. ${y} ${hh}:${mm}`;
}

function placeText(place) {
  if (!place) return '';
  const loc = place.location || {};
  const parts = [place.name, loc.street, loc.city].filter(Boolean);
  return parts.length ? `\nMísto: ${parts.join(', ')}` : '';
}

// Turns a Graph event into a chunk row (without embedding — that's added later
// only for new/changed rows). event_date = start_time (real, possibly future);
// highlight_until = end_time (or start +3h) so retrieval surfaces it as an
// active upcoming event until it ends. The date is also written into the content
// text so the model can state it directly. Returns null for undated events.
function buildEventRow(e) {
  if (!e.start_time || !e.name) return null;
  const start = new Date(e.start_time);
  const highlight = e.end_time
    ? new Date(e.end_time).toISOString()
    : new Date(start.getTime() + 3 * 3600000).toISOString();
  const desc = (e.description || '').trim();
  const content = `Akce: ${e.name}\nDatum: ${formatCz(e.start_time)}` +
    placeText(e.place) +
    (desc ? `\n\n${desc.slice(0, 1500)}` : '');

  return {
    content,
    document_title: `Liga vozíčkářů – akce: ${e.name}`,
    source_url: `https://www.facebook.com/events/${e.id}`,
    audience: AUDIENCE,
    source: SOURCE,
    chunk_index: 0,
    event_date: start.toISOString(),
    highlight_until: highlight,
    downloads: null
  };
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

// Builds a post chunk row (without embedding). Posts keep event_date = post date;
// dated events come from the Events endpoint, not captions.
function buildPostRow(p) {
  const text = p.message.trim();
  const createdISO = p.created_time;
  const highlight = isService(text)
    ? new Date(new Date(createdISO).getTime() + HIGHLIGHT_DAYS * 86400000).toISOString()
    : null;
  return {
    content: text,
    document_title: `Liga vozíčkářů – Facebook (${createdISO.slice(0, 10)})`,
    source_url: p.permalink_url || `https://facebook.com/${p.id}`,
    audience: AUDIENCE,
    source: SOURCE,
    chunk_index: 0,
    event_date: createdISO,
    highlight_until: highlight,
    downloads: null
  };
}

// All currently-stored Facebook rows, as a Map(source_url -> content), so we can
// tell what's new/changed/unchanged without re-reading embeddings. Paged to get
// past the default row cap.
async function loadExisting() {
  const existing = new Map();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('chunks')
      .select('source_url, content')
      .eq('source', SOURCE)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data || []) existing.set(r.source_url, r.content);
    if (!data || data.length < PAGE) break;
  }
  return existing;
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

  // Facebook Events — authoritative dated events (name + real start_time).
  const events = await getAllEvents(page.id);
  const eventRows = events.map(buildEventRow).filter(Boolean);
  console.log(`Events: ${events.length} fetched -> ${eventRows.length} dated.`);

  // Candidate rows (no embeddings yet): events first, then posts.
  const candidates = [...eventRows, ...unique.map(buildPostRow)];

  // Incremental diff against what's already stored — so we embed/write only the
  // delta instead of rebuilding (and re-embedding) every row each run.
  const existing = await loadExisting();
  const candUrls = new Set(candidates.map(c => c.source_url));
  const newRows = candidates.filter(c => !existing.has(c.source_url));
  const changedRows = candidates.filter(c => existing.has(c.source_url) && existing.get(c.source_url) !== c.content);
  const unchanged = candidates.length - newRows.length - changedRows.length;
  const orphans = [...existing.keys()].filter(u => !candUrls.has(u)); // removed on FB

  console.log(`Diff vs DB (${existing.size} stored): ${newRows.length} new, ${changedRows.length} changed, ${unchanged} unchanged, ${orphans.length} to remove.`);

  if (DRY_RUN) {
    if (newRows.length) {
      console.log('\n[DRY RUN] new items (no DB writes):');
      newRows.slice(0, 20).forEach(r => console.log(`+ ${r.document_title} | event_date=${r.event_date.slice(0, 10)}`));
      if (newRows.length > 20) console.log(`  ...and ${newRows.length - 20} more.`);
    } else {
      console.log('\n[DRY RUN] Nothing new.');
    }
    return;
  }

  if (newRows.length === 0 && changedRows.length === 0 && orphans.length === 0) {
    console.log('Nothing new today — DB already up to date. No embeddings spent.');
    return;
  }

  // Embed only the new + changed rows.
  const toWrite = [...newRows, ...changedRows];
  for (let i = 0; i < toWrite.length; i++) {
    toWrite[i].embedding = await embed(toWrite[i].content);
    await sleep(120); // gentle pacing to avoid hammering the quota
    process.stdout.write(`\r  embedded ${i + 1}/${toWrite.length}...`);
  }
  process.stdout.write('\n');

  // Remove rows that are gone on FB, plus the old copies of changed rows
  // (re-inserted below). Never touches website/eway rows. Batched for the
  // URL-list filter.
  const toDelete = [...orphans, ...changedRows.map(r => r.source_url)];
  const DELBATCH = 100;
  for (let i = 0; i < toDelete.length; i += DELBATCH) {
    const slice = toDelete.slice(i, i + DELBATCH);
    const { error: delErr } = await supabase.from('chunks').delete().eq('source', SOURCE).in('source_url', slice);
    if (delErr) throw delErr;
  }

  // Insert new + changed in batches.
  const BATCH = 100;
  for (let i = 0; i < toWrite.length; i += BATCH) {
    const slice = toWrite.slice(i, i + BATCH);
    const { error: insErr } = await supabase.from('chunks').insert(slice);
    if (insErr) throw insErr;
    process.stdout.write(`\r  inserted ${Math.min(i + BATCH, toWrite.length)}/${toWrite.length}...`);
  }

  console.log(`\nDone. +${newRows.length} new, ~${changedRows.length} changed, -${orphans.length} removed (source='${SOURCE}'). ${unchanged} unchanged rows left as-is.`);
}

main().catch(err => { console.error('\nERROR:', err.message); process.exit(1); });
