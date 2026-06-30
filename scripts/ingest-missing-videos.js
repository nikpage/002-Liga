#!/usr/bin/env node
// Ingest every FB page video that isn't already in the knowledge base. The
// previous pipeline only captured videos that arrived as reel POSTS; the page's
// /videos edge holds the full history (hundreds, back years) that was never
// ingested. For each missing video this downloads the MP4, classifies the audio
// (speech -> Czech transcript, music -> song reference, silent -> caption only),
// embeds, and inserts a chunk matching the FB ingest schema.
//
// Idempotent: skips any video id already present, so it is safe to re-run if FB
// rate-limits mid-way.
//
// Usage:  node scripts/ingest-missing-videos.js --dry-run
//         node scripts/ingest-missing-videos.js --limit 5
//         node scripts/ingest-missing-videos.js
require('dotenv').config();

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const { getEmb } = require('../ai-client');

const GRAPH = 'https://graph.facebook.com/v21.0';
const SOURCE = 'facebook';
const AUDIENCE = 'public_web';
const MARKER = '[Přepis videa]';
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i !== -1 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : Infinity; })();

function loadToken() {
  if (process.env.FB_TOKEN) return process.env.FB_TOKEN.trim();
  if (fs.existsSync('fb-token.local')) { const t = fs.readFileSync('fb-token.local', 'utf8').trim(); if (t) return t; }
  return null;
}
const TOKEN = loadToken();
if (!TOKEN) { console.error('Missing token (fb-token.local or FB_TOKEN).'); process.exit(1); }

const supabase = createClient(config.supabase.url, config.supabase.key);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const redact = m => String(m == null ? '' : m).replace(/(key|access_token)=[\w.-]+/g, '$1=REDACTED');

function build(p, params = {}) {
  const url = new URL(`${GRAPH}/${p}`);
  url.searchParams.set('access_token', TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}
async function getJson(url) { const r = await fetch(url); const j = await r.json(); if (j.error) throw new Error(j.error.message); return j; }

function absoluteUrl(u) {
  const s = String(u || '');
  if (!s) return '';
  if (/^https?:\/\//.test(s)) return s;
  return 'https://www.facebook.com' + (s.startsWith('/') ? s : '/' + s);
}
function videoId(url) { const m = String(url || '').match(/(?:reel|videos)\/(\d+)/) || String(url).match(/[?&]v=(\d+)/); return m ? m[1] : null; }

function isForeignSong(t) {
  const s = String(t || '');
  return !/[ěščřžýáíéůúňťďĚŠČŘŽÝÁÍÉŮÚŇŤĎ]/.test(s) &&
    /\b(the|I'm|you|your|world|love|never|gonna|baby|night|waiting|dreaming|ooh|yeah|girl|heart)\b/i.test(s);
}

async function classifyVideo(mp4Url) {
  const tmp = path.join(os.tmpdir(), `liga-vid-${process.pid}-${Math.floor(performance.now())}`);
  const mp4 = `${tmp}.mp4`, mp3 = `${tmp}.mp3`;
  try {
    const res = await fetch(mp4Url);
    if (!res.ok) return { type: 'silent' };
    fs.writeFileSync(mp4, Buffer.from(await res.arrayBuffer()));
    try { execFileSync('ffmpeg', ['-y', '-i', mp4, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', mp3], { stdio: 'ignore' }); }
    catch { return { type: 'silent' }; }
    const audio = fs.readFileSync(mp3);
    if (!audio.length) return { type: 'silent' };
    const prompt = `Klasifikuj audio z tohoto videa. Odpověz POUZE platným JSON bez dalšího textu:
{"type":"speech"|"music"|"silent","transcript":"<přesný český přepis mluveného slova, jinak prázdný řetězec>","song":"<název skladby nebo prázdné>","artist":"<interpret nebo prázdné>"}
Pokud někdo mluví, type="speech" a vyplň transcript. Pokud jen hudba/zpěv bez mluveného komentáře, type="music" a zkus identifikovat skladbu a interpreta. Pokud nic, type="silent".`;
    const body = { contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'audio/mp3', data: audio.toString('base64') } }] }], generationConfig: { response_mime_type: 'application/json' } };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${config.google.chatModel}:generateContent?key=${config.google.key}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = await r.json();
    if (out.error) throw new Error(out.error.message);
    const raw = (out.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
    let parsed; try { parsed = JSON.parse(raw); } catch { return { type: 'silent' }; }
    const transcript = String(parsed.transcript || '').trim();
    if (parsed.type === 'speech' && transcript && isForeignSong(transcript)) return { type: 'music', song: String(parsed.song || '').trim(), artist: String(parsed.artist || '').trim() };
    if (parsed.type === 'speech' && transcript) return { type: 'speech', transcript };
    if (parsed.type === 'music') return { type: 'music', song: String(parsed.song || '').trim(), artist: String(parsed.artist || '').trim() };
    return { type: 'silent' };
  } catch (e) { console.error(`\n  classify error: ${redact(e.message)}`); return { type: 'silent' }; }
  finally { for (const f of [mp4, mp3]) { try { fs.unlinkSync(f); } catch {} } }
}

async function embed(text) {
  for (let a = 0; a < 7; a++) {
    try { return await getEmb(text); }
    catch (e) { if (/exhaust|quota|rate|429|unavailable|503|internal|500|timeout|ETIMEDOUT|ECONNRESET/i.test(e.message) && a < 6) { await sleep(5000 * (a + 1)); continue; } throw e; }
  }
}

async function main() {
  if (!config.supabase.url || !config.supabase.key) throw new Error('Missing Supabase creds');
  if (!config.google.key) throw new Error('Missing GOOGLE_API_KEY');
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { throw new Error('ffmpeg not on PATH'); }

  const me = await getJson(build('me', { fields: 'id' }));
  // All page videos (full history).
  const live = [];
  let url = build(`${me.id}/videos`, { fields: 'id,created_time,description,permalink_url', limit: '50' });
  while (url) { const p = await getJson(url); for (const v of p.data || []) live.push(v); url = p.paging?.next || null; }

  // Existing FB video ids in DB.
  const have = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('chunks').select('source_url').eq('source', SOURCE)
      .or('source_url.like.%/reel/%,source_url.like.%/videos/%').range(from, from + 999);
    if (error) throw error;
    (data || []).forEach(r => { const id = videoId(r.source_url); if (id) have.add(id); });
    if (!data || data.length < 1000) break;
  }

  const missing = live.filter(v => !have.has(v.id)).slice(0, LIMIT);
  console.log(`Live videos: ${live.length}, already in DB: ${have.size}, missing to ingest: ${missing.length}`);
  if (!missing.length) { console.log('Nothing missing.'); return; }
  if (DRY_RUN) { missing.slice(0, 15).forEach(v => console.log(`  ${v.created_time?.slice(0,10)} ${v.permalink_url || v.id}`)); console.log('\n[DRY RUN] No downloads, no writes.'); return; }

  let speech = 0, music = 0, capOnly = 0, skipped = 0, noSource = 0;
  for (let i = 0; i < missing.length; i++) {
    const v = missing[i];
    let srcUrl = '';
    try { srcUrl = (await getJson(build(v.id, { fields: 'source' }))).source || ''; } catch { srcUrl = ''; }
    if (!srcUrl) { noSource++; continue; }

    const verdict = await classifyVideo(srcUrl);
    await sleep(150);

    const caption = String(v.description || '').trim();
    const link = absoluteUrl(v.permalink_url || `https://www.facebook.com/${v.id}`);
    const musicRef = verdict.type === 'music' ? [verdict.song, verdict.artist].filter(Boolean).join(' – ') : '';

    // Decide what (if anything) is worth indexing for this video.
    let bodyText = caption, kind = null;
    if (verdict.type === 'speech') { bodyText += `\n\n${MARKER}\n${verdict.transcript}`; kind = 'speech'; }
    else if (musicRef) { bodyText += `\n\nHudba ve videu: ${musicRef}`; kind = 'music'; }
    else if (caption) { kind = 'caption'; }

    // Silent / music-with-unknown-song AND no caption -> nothing to index.
    if (!kind) { skipped++; continue; }

    const content = (bodyText + (link ? `\n\nOdkaz na video: ${link}` : '')).trim();
    if (!content) { skipped++; continue; }
    if (kind === 'speech') speech++; else if (kind === 'music') music++; else capOnly++;

    const emb = await embed(content);
    await sleep(120);
    const row = {
      content,
      document_title: `Liga vozíčkářů – Facebook (${(v.created_time || '').slice(0, 10)})`,
      source_url: link,
      audience: AUDIENCE,
      source: SOURCE,
      chunk_index: 0,
      event_date: v.created_time || null,
      highlight_until: null,
      downloads: null,
      embedding: emb,
    };
    const { error } = await supabase.from('chunks').insert(row);
    if (error) { console.error(`\n  insert error ${v.id}: ${error.message}`); continue; }
    process.stdout.write(`\r  ${i + 1}/${missing.length}: ${speech} speech, ${music} music, ${capOnly} caption-only, ${noSource} no-source, ${skipped} skipped...`);
  }
  process.stdout.write('\n');
  console.log(`Done. Inserted: ${speech} speech + ${music} music + ${capOnly} caption-only. ${noSource} had no source, ${skipped} skipped (empty).`);
}

main().catch(e => { console.error('\nERROR:', redact(e.message)); process.exit(1); });
