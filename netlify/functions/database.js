const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.getFullContext = async (embedding, query) => {
  // Updated RPC name to match the 'chunks' table context
  const { data, error } = await supabase.rpc('match_chunks', {
    query_embedding: embedding,
    match_threshold: 0.45,
    match_count: 30
  });

  if (error) throw error;

  const chunks = (data || []).map(r => ({
    id: r.id,
    text: r.content,
    title: r.document_title,
    url: r.source_url,
    downloads: r.downloads
  }));

  return { chunks };
};

exports.getFileUrls = (chunks) => {
  const re = /(https?:\/\/[^\s]+\.(?:pdf|docx?|xlsx?))/gi;
  const out = new Set();

  (chunks || []).forEach(chunk => {
    const c = chunk.text || '';
    const matches = c.matchAll(re);
    for (const match of matches) {
      out.add(match[1]);
    }
  });

  return Array.from(out);
};
