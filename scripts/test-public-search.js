require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const { getEmb } = require('../ai-client');

const supabase = createClient(
  config.supabase.url,
  config.supabase.key
);

async function main() {
  const query = process.argv[2];
  if (!query) {
    console.error('Usage: node scripts/test-public-search.js "your query"');
    process.exit(1);
  }

  const embedding = await getEmb(query);

  const { data, error } = await supabase.rpc('match_chunks', {
    query_embedding: embedding,
    match_threshold: 0.45,
    match_count: 10,
    audience_filter: ['public_web']
  });

  if (error) {
    console.error('SUPABASE RPC ERROR:', error);
    process.exit(1);
  }

  const results = data || [];
  if (results.length === 0) {
    console.log('No results.');
    return;
  }

  results.forEach((r, i) => {
    const sim = typeof r.similarity === 'number' ? r.similarity.toFixed(3) : String(r.similarity);
    const content = (r.content || '').slice(0, 300);
    console.log(`--- result ${i + 1} (similarity: ${sim}) ---`);
    console.log(`title: ${r.title ?? ''}`);
    console.log(`source_url: ${r.source_url ?? ''}`);
    console.log(`content (first 300 chars): ${content}`);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
