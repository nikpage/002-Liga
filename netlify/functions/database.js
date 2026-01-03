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
    url: r.source_url
  }));

  return { chunks };
};

exports.getFileUrls = async () => {
  // Updated table name from 'document_chunks' to 'chunks'
  const { data, error } = await supabase
    .from('chunks')
    .select('content');

  if (error) throw error;

  const re = /(https?:\/\/[^\s]+\.(?:pdf|docx?|xlsx?))/gi;
  const out = new Set();

  (data || []).forEach(r => {
    const c = r.content || '';
    const matches = c.matchAll(re);
    for (const match of matches) {
      out.add(match[1]);
    }
  });

  return Array.from(out);
};
