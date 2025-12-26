const { createClient } = require('@supabase/supabase-js');
const { supabase: cfg } = require("./config");

const supabase = createClient(cfg.url, cfg.key);

async function getFullContext(vector, query) {
  try {
    // Use Supabase vector search to find similar chunks
    const { data, error } = await supabase.rpc('match_chunks', {
      query_embedding: vector,
      match_threshold: 0.1,
      match_count: 25
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
