const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(
  config.supabase.url,
  config.supabase.key
);

exports.getFullContext = async (embedding, query) => {
  const { data, error } = await supabase.rpc('match_chunks', {
    query_embedding: embedding,
    match_threshold: 0.45,
    match_count: 30
  }, {
    head: false,
    count: null
  });

  if (error) {
    console.error("SUPABASE RPC ERROR:", error);
    throw error;
  }

  return { chunks: data || [] };
};
