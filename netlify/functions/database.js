const { createClient } = require('@supabase/supabase-js');
const { supabase: cfg } = require("./config");

let supabase = null;

function getSupabaseClient() {
  if (!supabase) {
    supabase = createClient(cfg.url, cfg.key);
  }
  return supabase;
}

async function getFullContext(vector, query) {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('match_document_chunks', {
      query_embedding: vector,
      match_threshold: 0.15,
      match_count: 30
    });

    if (error) throw error;

    const chunks = data.map(row => ({
      text: row.content,
      title: row.document_title,
      url: row.source_url
    }));

    return { chunks };
  } catch (error) {
    console.error("Database error:", error);
    throw error;
  }
}

module.exports = { getFullContext };
