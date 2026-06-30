#!/usr/bin/env node
// DB-only fix: website video chunks were ingested with a dead homepage-anchor
// URL (https://www.ligavozickaru.cz/#video-<ytId>) that scrolls nowhere, so when
// the Q&A cites them the link goes to the homepage hero video. The YouTube ID is
// right there in the anchor, so rewrite source_url to the real watchable video
// (https://youtu.be/<ytId>). Content is unchanged, so no re-embed is needed.
//
// Usage:  node scripts/fix-video-anchor-urls.js --dry-run
//         node scripts/fix-video-anchor-urls.js
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

const DRY_RUN = process.argv.includes('--dry-run');
const supabase = createClient(config.supabase.url, config.supabase.key);

function ytLink(url) {
  const m = String(url || '').match(/#video-([A-Za-z0-9_-]{6,})/);
  return m ? `https://youtu.be/${m[1]}` : null;
}

async function main() {
  const { data, error } = await supabase
    .from('chunks')
    .select('id, source_url')
    .ilike('source_url', '%/#video-%');
  if (error) throw error;

  // Only homepage-rooted anchors (https://www.ligavozickaru.cz/#video-...) are
  // truly dead — they scroll nowhere, landing on the homepage hero. Anchors on
  // real topic pages (/sexy-den/#video-...) keep useful page context, so leave
  // those alone.
  const isHomepageRooted = u => /ligavozickaru\.cz\/?$/.test(String(u).split('#')[0]);
  const targets = (data || [])
    .filter(r => isHomepageRooted(r.source_url))
    .map(r => ({ ...r, next: ytLink(r.source_url) }))
    .filter(r => r.next);
  console.log(`Found ${targets.length} homepage-rooted dead #video- URLs.`);
  const sample = targets.slice(0, 8);
  sample.forEach(r => console.log(`  ${r.source_url}\n    -> ${r.next}`));
  if (targets.length > sample.length) console.log(`  ...and ${targets.length - sample.length} more.`);
  if (!targets.length) { console.log('Nothing to fix.'); return; }
  if (DRY_RUN) { console.log('\n[DRY RUN] No writes.'); return; }

  let fixed = 0;
  for (const r of targets) {
    const { error: e } = await supabase.from('chunks').update({ source_url: r.next }).eq('id', r.id);
    if (e) { console.error(`  error id=${r.id}: ${e.message}`); continue; }
    fixed++;
  }
  console.log(`Done. ${fixed} citation URLs rewritten to real YouTube links.`);
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
