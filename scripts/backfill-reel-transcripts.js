#!/usr/bin/env node
// One-shot backfill: for every FB video/reel row in the DB that is still missing
// [Přepis videa], download the original MP4 (Graph `source` field), strip the
// video track with ffmpeg (audio only — ~10x cheaper than sending video to the
// model), transcribe the Czech audio with Gemini, append the transcript + a
// link back to the original video, then re-embed so it is searchable in the Q&A.
//
// Why audio, not captions: the Graph `captions` edge only returns FB
// auto-generated *translations* (and only for a tiny fraction of videos), never
// the original Czech speech. Transcribing the audio is the only reliable path.
// See scripts/backfill-reel-subtitles.js for the (now superseded) captions route.
//
// Requirements: ffmpeg on PATH, GOOGLE_API_KEY (already used for embeddings/chat),
// FB_TOKEN (or fb-token.local), Supabase service-role creds.
//
// Usage:  node scripts/backfill-reel-transcripts.js
//         node scripts/backfill-reel-transcripts.js --dry-run
//         node scripts/backfill-reel-transcripts.js --limit 5
require('dotenv').config();

const fetch = require('node-fetch');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const { getEmb } = require('../ai-client');

const GRAPH = 'https://graph.facebook.com/v21.0';
const SOURCE = 'facebook';
const MARKER = '[Přepis videa]';
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i !== -1 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : Infinity;
})();

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
const sleep = ms => new Promise(r => setTimeout(r, ms));

// node-fetch errors echo the full request URL, and the Gemini API carries the
// API key in `?key=...`. Never let that reach logs (this is exactly how a key
// leaked into a committed log file before).
function redact(msg) {
  return String(msg == null ? '' : msg).replace(/key=[\w.-]+/g, 'key=REDACTED');
}

function build(p, params = {}) {
  const url = new URL(`${GRAPH}/${p}`);
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

// Pulls the numeric video id out of either permalink shape:
//   /reel/<id>/            or   /<pageId>/videos/<id>   or   /watch/?v=<id>
function extractVideoId(permalinkUrl) {
  const s = String(permalinkUrl || '');
  let m = s.match(/\/reel\/(\d+)/); if (m) return m[1];
  m = s.match(/\/videos\/(\d+)/); if (m) return m[1];
  m = s.match(/[?&]v=(\d+)/); if (m) return m[1];
  return null;
}

// Stored permalinks are often relative (e.g. "/reel/123/"); make an absolute
// link so the transcript can point back at the original video inside answers.
function absoluteUrl(u) {
  const s = String(u || '');
  if (!s) return '';
  if (/^https?:\/\//.test(s)) return s;
  return 'https://www.facebook.com' + (s.startsWith('/') ? s : '/' + s);
}

// Resolves a video id to a fresh, downloadable MP4 url. `source` urls are
// short-lived and signed, so we fetch one right before downloading.
async function getVideoSource(videoId) {
  try {
    const data = await getJson(build(videoId, { fields: 'source' }));
    return data.source || '';
  } catch {
    return '';
  }
}

// Download MP4 -> ffmpeg strips video, downmixes to mono 16kHz mp3 -> Gemini
// classifies the audio. Returns one of:
//   { type: 'speech',  transcript }              -> real spoken Czech to save
//   { type: 'music',   song, artist }            -> backing track, no narration
//   { type: 'silent' }                           -> no audio stream / empty
// We classify (not just transcribe) so song lyrics never get saved as if they
// were spoken content; music reels keep only their caption + a song reference.
// Temp files are always cleaned up.
async function classifyVideo(mp4Url) {
  const tmpBase = path.join(os.tmpdir(), `liga-reel-${process.pid}-${Date.now()}`);
  const mp4Path = `${tmpBase}.mp4`;
  const mp3Path = `${tmpBase}.mp3`;
  try {
    const res = await fetch(mp4Url);
    if (!res.ok) return { type: 'silent' };
    fs.writeFileSync(mp4Path, Buffer.from(await res.arrayBuffer()));

    // ffmpeg fails ("does not contain any stream") when the reel has no audio
    // track at all — a genuinely silent video-only montage.
    try {
      execFileSync('ffmpeg', ['-y', '-i', mp4Path, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', mp3Path],
        { stdio: 'ignore' });
    } catch {
      return { type: 'silent' };
    }
    const audio = fs.readFileSync(mp3Path);
    if (!audio.length) return { type: 'silent' };

    const prompt = `Klasifikuj audio z tohoto videa. Odpověz POUZE platným JSON bez dalšího textu:
{"type":"speech"|"music"|"silent","transcript":"<přesný český přepis mluveného slova, jinak prázdný řetězec>","song":"<název skladby nebo prázdné>","artist":"<interpret nebo prázdné>"}
Pokud někdo mluví (komentář, vyprávění, rozhovor), type="speech" a vyplň transcript.
Pokud je tam jen hudba nebo zpěv bez mluveného komentáře, type="music" a zkus identifikovat skladbu a interpreta.
Pokud není slyšet nic, type="silent".`;
    const body = {
      contents: [{ parts: [
        { text: prompt },
        { inline_data: { mime_type: 'audio/mp3', data: audio.toString('base64') } },
      ] }],
      generationConfig: { response_mime_type: 'application/json' },
    };
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.google.chatModel}:generateContent?key=${config.google.key}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = await r.json();
    if (out.error) throw new Error(out.error.message || 'gemini error');
    const raw = (out.candidates && out.candidates[0] && out.candidates[0].content &&
      out.candidates[0].content.parts || []).map(p => p.text || '').join('').trim();
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return { type: 'silent' }; }

    const transcript = String(parsed.transcript || '').trim();
    if (parsed.type === 'speech' && transcript) return { type: 'speech', transcript };
    if (parsed.type === 'music') {
      return { type: 'music', song: String(parsed.song || '').trim(), artist: String(parsed.artist || '').trim() };
    }
    // A "speech" verdict with an empty transcript is effectively silent for us.
    return { type: parsed.type === 'music' ? 'music' : 'silent' };
  } catch (e) {
    console.error(`\n  classify error: ${redact(e.message)}`);
    return { type: 'silent' };
  } finally {
    for (const f of [mp4Path, mp3Path]) { try { fs.unlinkSync(f); } catch {} }
  }
}

// Strips any block this script previously appended (transcript / music ref /
// link), leaving just the original post caption — so re-runs rebuild cleanly
// instead of stacking duplicates.
function baseCaption(content) {
  const s = String(content || '');
  const markers = [`\n\n${MARKER}`, '\n\nHudba ve videu:', '\n\nOdkaz na video:'];
  let cut = s.length;
  for (const m of markers) {
    const i = s.indexOf(m);
    if (i !== -1 && i < cut) cut = i;
  }
  return s.slice(0, cut).trim();
}

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
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); }
  catch { throw new Error('ffmpeg not found on PATH'); }

  // Every FB video/reel row. Both permalink shapes (/reel/ and /videos/) are
  // matched. By default ALL are (re)processed so previously mis-saved song
  // lyrics get corrected; --only-missing restricts to rows lacking a transcript
  // (cheaper incremental top-up). Paged in case of >1000 rows.
  const onlyMissing = process.argv.includes('--only-missing');
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from('chunks')
      .select('id, source_url, content')
      .eq('source', SOURCE)
      .or('source_url.like.%/reel/%,source_url.like.%/videos/%');
    if (onlyMissing) q = q.not('content', 'like', `%${MARKER}%`);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data || []) rows.push(r);
    if (!data || data.length < PAGE) break;
  }

  const targets = rows.filter(r => extractVideoId(r.source_url)).slice(0, LIMIT);
  console.log(`Found ${rows.length} video rows${onlyMissing ? ' without transcript' : ''}; processing ${targets.length}.`);
  if (!targets.length) { console.log('Nothing to do.'); return; }

  if (DRY_RUN) {
    targets.slice(0, 20).forEach(r => console.log(`  ${absoluteUrl(r.source_url)}`));
    if (targets.length > 20) console.log(`  ...and ${targets.length - 20} more.`);
    console.log('\n[DRY RUN] No downloads, no writes.');
    return;
  }

  let speech = 0, music = 0, silent = 0, unchanged = 0, noSource = 0;

  for (let i = 0; i < targets.length; i++) {
    const r = targets[i];
    const videoId = extractVideoId(r.source_url);

    const mp4Url = await getVideoSource(videoId);
    if (!mp4Url) { noSource++; continue; }

    const verdict = await classifyVideo(mp4Url);
    await sleep(150);

    // Rebuild from the original caption so reruns never stack duplicate blocks.
    const caption = baseCaption(r.content);
    const link = absoluteUrl(r.source_url);
    let body = caption;
    if (verdict.type === 'speech') {
      body += `\n\n${MARKER}\n${verdict.transcript}`;
      speech++;
    } else if (verdict.type === 'music') {
      const ref = [verdict.song, verdict.artist].filter(Boolean).join(' – ');
      if (ref) body += `\n\nHudba ve videu: ${ref}`;
      music++;
    } else {
      silent++;
    }
    const newContent = (body + (link ? `\n\nOdkaz na video: ${link}` : '')).trim();

    if (newContent === String(r.content || '').trim()) { unchanged++; continue; }

    const emb = await embed(newContent);
    await sleep(120);

    const { error: updErr } = await supabase
      .from('chunks')
      .update({ content: newContent, embedding: emb })
      .eq('id', r.id);
    if (updErr) { console.error(`\n  error updating ${r.source_url}: ${redact(updErr.message)}`); continue; }

    process.stdout.write(`\r  ${i + 1}/${targets.length}: ${speech} speech, ${music} music, ${silent} silent, ${unchanged} unchanged...`);
  }

  process.stdout.write('\n');
  console.log(`Done. ${speech} speech transcripts, ${music} music refs, ${silent} silent. ` +
    `${unchanged} already correct, ${noSource} had no downloadable source.`);
}

main().catch(err => { console.error('\nERROR:', redact(err.message)); process.exit(1); });
