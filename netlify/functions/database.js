const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.getFullContext = async (embedding, query) => {
  const { data, error } = await supabase.rpc('match_document_chunks', {
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

exports.getFileUrls = async (embedding) => {
  const { data, error } = await supabase.rpc('match_document_chunks', {
    query_embedding: embedding,
    match_threshold: 0.45,
    match_count: 30
  });

  if (error) throw error;

  const re = /https?:\/\/[^\s"]+\.(pdf|docx?|xlsx?)/gi;
  const out = new Set();

  (data || []).forEach(r => {
    const c = r.content || '';
    const m = c.match(re);
    if (m) m.forEach(u => out.add(u));
  });

  return Array.from(out);
};
