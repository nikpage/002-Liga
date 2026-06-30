#!/usr/bin/env node
// Post-ingest cleanup of two defects in the FB video ingest:
//  1) Duplicate rows — event-attached videos have /events/.../permalink/ URLs
//     that the id-based dedup missed, so a re-run inserted them twice. Keep the
//     copy with the most content per source_url, delete the rest.
//  2) Guessed song names — Gemini's audio song-ID is unreliable, so storing
//     "Hudba ve videu: <song>" asserts likely-wrong facts. Strip that line
//     (leaving caption + link) and re-embed. The video link remains for anyone
//     who wants to check the real track.
//
// Usage:  node scripts/fix-video-data.js --dry-run
//         node scripts/fix-video-data.js
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const { getEmb } = require('../ai-client');

const DRY_RUN = process.argv.includes('--dry-run');
const supabase = createClient(config.supabase.url, config.supabase.key);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function loadFacebookRows() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('chunks')
      .select('id, source_url, content').eq('source', 'facebook').range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

// Remove ONLY the single "Hudba ve videu: ..." line ([^\n]* so it never eats the
// following Odkaz/link line), then tidy blank lines.
function stripSong(content) {
  return String(content || '').replace(/\n*Hudba ve videu:[^\n]*/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

async function main() {
  const rows = await loadFacebookRows();

  // 1) Duplicates by source_url — keep the longest-content row, delete the rest.
  const byUrl = {};
  for (const r of rows) (byUrl[r.source_url] = byUrl[r.source_url] || []).push(r);
  const toDelete = [];
  for (const ids of Object.values(byUrl)) {
    if (ids.length < 2) continue;
    ids.sort((a, b) => (b.content || '').length - (a.content || '').length);
    toDelete.push(...ids.slice(1).map(r => r.id)); // keep [0] (longest)
  }

  // 2) Guessed-song rows.
  const songRows = rows.filter(r => /Hudba ve videu:/.test(r.content || ''));

  console.log(`Duplicate rows to delete: ${toDelete.length}`);
  console.log(`Guessed-song rows to clean: ${songRows.length}`);
  if (DRY_RUN) {
    console.log('  sample delete ids:', toDelete.slice(0, 12).join(', '));
    console.log('\n[DRY RUN] No writes.');
    return;
  }

  // Apply deletes first (narrow: explicit id list).
  if (toDelete.length) {
    const { error } = await supabase.from('chunks').delete().in('id', toDelete);
    if (error) throw new Error(`delete failed: ${error.message}`);
    console.log(`Deleted ${toDelete.length} duplicate rows.`);
  }

  // Strip song lines + re-embed (skip any that were just deleted).
  const del = new Set(toDelete);
  let cleaned = 0;
  for (const r of songRows) {
    if (del.has(r.id)) continue;
    const next = stripSong(r.content);
    if (next === String(r.content).trim()) continue;
    // Music-only video with no caption/link left -> nothing to index, remove it.
    if (!next) {
      const { error } = await supabase.from('chunks').delete().eq('id', r.id);
      if (error) { console.error(`  delete error id=${r.id}: ${error.message}`); continue; }
      cleaned++; continue;
    }
    const emb = await getEmb(next);
    await sleep(120);
    const { error } = await supabase.from('chunks').update({ content: next, embedding: emb }).eq('id', r.id);
    if (error) { console.error(`  update error id=${r.id}: ${error.message}`); continue; }
    cleaned++;
    process.stdout.write(`\r  ${cleaned}/${songRows.length} song lines stripped...`);
  }
  process.stdout.write('\n');
  console.log(`Done. ${toDelete.length} duplicates removed, ${cleaned} song lines stripped.`);
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
