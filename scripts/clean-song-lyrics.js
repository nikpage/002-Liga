#!/usr/bin/env node
// DB-only cleanup (no Facebook calls): finds FB chunks whose saved [Přepis videa]
// block is actually foreign-language SONG LYRICS (Gemini mislabelled sung music
// as speech), strips that block back to the original caption + link, and
// re-embeds. Pure Supabase + Google embedding — unaffected by FB rate limits.
//
// Usage:  node scripts/clean-song-lyrics.js --dry-run   (list what would change)
//         node scripts/clean-song-lyrics.js             (apply)
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const { getEmb } = require('../ai-client');

const MARKER = '[Přepis videa]';
const DRY_RUN = process.argv.includes('--dry-run');
const supabase = createClient(config.supabase.url, config.supabase.key);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Same conservative test used by the backfill: no Czech diacritics + English
// words => foreign song lyrics, not Czech narration.
function isForeignSong(t) {
  const s = String(t || '');
  const hasCzech = /[ěščřžýáíéůúňťďĚŠČŘŽÝÁÍÉŮÚŇŤĎ]/.test(s);
  const looksEnglish = /\b(the|I'm|you|your|world|love|never|gonna|baby|night|waiting|dreaming|ooh|yeah|girl|heart)\b/i.test(s);
  return !hasCzech && looksEnglish;
}

// Strip any block this pipeline appended, leaving just the original caption.
function baseCaption(content) {
  const s = String(content || '');
  const markers = [`\n\n${MARKER}`, '\n\nHudba ve videu:', '\n\nOdkaz na video:'];
  let cut = s.length;
  for (const m of markers) { const i = s.indexOf(m); if (i !== -1 && i < cut) cut = i; }
  return s.slice(0, cut).trim();
}

function absoluteUrl(u) {
  const s = String(u || '');
  if (!s) return '';
  if (/^https?:\/\//.test(s)) return s;
  return 'https://www.facebook.com' + (s.startsWith('/') ? s : '/' + s);
}

async function main() {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('chunks')
      .select('id, source_url, content')
      .eq('source', 'facebook')
      .ilike('content', `%${MARKER}%`)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of data || []) rows.push(r);
    if (!data || data.length < PAGE) break;
  }

  // A row is a target when the transcript portion (after the marker, before the
  // link) reads as a foreign song.
  const targets = rows.filter(r => {
    const after = (String(r.content).split(MARKER)[1] || '').replace(/\n\nOdkaz na video:.*/s, '');
    return isForeignSong(after);
  });

  console.log(`Scanned ${rows.length} transcript rows; ${targets.length} are foreign song lyrics to strip.`);
  targets.forEach(r => console.log(`  ${absoluteUrl(r.source_url)}`));
  if (!targets.length) { console.log('Nothing to clean.'); return; }
  if (DRY_RUN) { console.log('\n[DRY RUN] No writes.'); return; }

  let cleaned = 0;
  for (const r of targets) {
    const link = absoluteUrl(r.source_url);
    const newContent = (baseCaption(r.content) + (link ? `\n\nOdkaz na video: ${link}` : '')).trim();
    if (newContent === String(r.content).trim()) continue;
    const emb = await getEmb(newContent);
    await sleep(120);
    const { error } = await supabase.from('chunks').update({ content: newContent, embedding: emb }).eq('id', r.id);
    if (error) { console.error(`  error ${r.source_url}: ${error.message}`); continue; }
    cleaned++;
    process.stdout.write(`\r  ${cleaned}/${targets.length} cleaned...`);
  }
  process.stdout.write('\n');
  console.log(`Done. ${cleaned} rows stripped of song lyrics and re-embedded.`);
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
