#!/usr/bin/env node
// One-shot backfill: fetches subtitle tracks for FB reel rows in the DB that
// are missing [Přepis videa], then re-embeds them so they are searchable.
// Safe to re-run — the DB query skips rows already containing [Přepis videa].
//
// Usage:  node scripts/backfill-reel-subtitles.js
//         node scripts/backfill-reel-subtitles.js --dry-run
require('dotenv').config();

const fetch = require('node-fetch');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const { getEmb } = require('../ai-client');

const GRAPH = 'https://graph.facebook.com/v21.0';
const SOURCE = 'facebook';
const DRY_RUN = process.argv.includes('--dry-run');

function loadToken() {
  if (process.env.FB_TOKEN) return process.env.FB_TOKEN.trim();
  if (fs.existsSync('fb-token.local')) {
    const t = fs.readFileSync('fb-token.local', 'utf8').trim();
    if (t) return t;
  }
  if (fs.existsSync('fb-run-command.txt')) {
    const m = fs.readFileSync('fb-run-command.txt', 'utf8').match(/FB_TOKEN=(\S+)/);
    if (m && m[1] && m[1] !== 'PASTE_YOUR_TOKEN_HERE') return m[1];
  }
  return null;
}

const TOKEN = loadToken();
if (!TOKEN) { console.error('Missing token. Put it in fb-token.local or set FB_TOKEN.'); process.exit(1); }

const supabase = createClient(config.supabase.url, config.supabase.key);

function build(path, params = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  url.searchParams.set('access_token', TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

async function getJson(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

function extractVideoId(permalinkUrl) {
  const m = String(permalinkUrl || '').match(/\/reel\/(\d+)/);
  return m ? m[1] : null;
}

async function fetchVttText(vttUrl) {
  try {
    const res = await fetch(vttUrl);
    const raw = await res.text();
    const out = [];
    let prev = '';
    for (const line of raw.split('\n')) {
      const l = line.trim();
      if (!l || l === 'WEBVTT' || /^\d+$/.test(l) || /-->/.test(l) || /^[A-Z][\w-]+:/.test(l)) continue;
      if (l !== prev) { out.push(l); prev = l; }
    }
    return out.join(' ').trim();
  } catch {
    return '';
  }
}

async function getSubtitleText(videoId) {
  try {
    const data = await getJson(build(videoId, { fields: 'captions' }));
    const caps = data.captions && data.captions.data;
    if (!caps || !caps.length) return '';
    const cz = caps.find(c => c.locale && c.locale.startsWith('cs')) || caps[0];
    if (!cz || !cz.uri) return '';
    return await fetchVttText(cz.uri);
  } catch {
    return '';
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function embed(text) {
  for (let attempt = 0; attempt < 7; attempt++) {
    try {
      return await getEmb(text);
    } catch (e) {
      if (/exhaust|quota|rate|429/i.test(e.message) && attempt < 6) {
        const wait = 5000 * (attempt + 1);
        process.stdout.write(`\r  rate limited, waiting ${wait / 1000}s...        `);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

async function main() {
  if (!config.supabase.url || !config.supabase.key) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  if (!config.google.key) throw new Error('Missing GOOGLE_API_KEY');

  // Load every FB reel row that does not yet have subtitle content. Paginated
  // in case there are more than 1000.
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('chunks')
      .select('id, source_url, content')
      .eq('source', SOURCE)
      .like('source_url', '%/reel/%')
      .not('content', 'like', '%[Přepis videa]%')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data || []) rows.push(r);
    if (!data || data.length < PAGE) break;
  }

  console.log(`Found ${rows.length} reel rows without subtitles.`);
  if (!rows.length) { console.log('Nothing to do.'); return; }

  if (DRY_RUN) {
    rows.slice(0, 20).forEach(r => console.log(`  ${r.source_url}`));
    if (rows.length > 20) console.log(`  ...and ${rows.length - 20} more.`);
    console.log('\n[DRY RUN] No writes.');
    return;
  }

  let updated = 0;
  let noCaption = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const videoId = extractVideoId(r.source_url);
    if (!videoId) { noCaption++; continue; }

    const subs = await getSubtitleText(videoId);
    await sleep(200);

    if (!subs) { noCaption++; continue; }

    const newContent = r.content
      ? `${r.content}\n\n[Přepis videa]\n${subs}`
      : `[Přepis videa]\n${subs}`;

    const emb = await embed(newContent);
    await sleep(120);

    const { error: updErr } = await supabase
      .from('chunks')
      .update({ content: newContent, embedding: emb })
      .eq('id', r.id);

    if (updErr) { console.error(`\n  error updating ${r.source_url}: ${updErr.message}`); continue; }

    updated++;
    process.stdout.write(`\r  ${i + 1}/${rows.length}: ${updated} updated, ${noCaption} no caption...`);
  }

  process.stdout.write('\n');
  console.log(`Done. ${updated} reels updated with subtitles. ${noCaption} had no caption available.`);
}

main().catch(err => { console.error('\nERROR:', err.message); process.exit(1); });
