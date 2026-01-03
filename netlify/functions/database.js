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

  // Match URLs that may be after markdown bullets (- ) or on their own
  const re = /(?:^|\s|-\s+)(https?:\/\/[^\s]+?\.(pdf|docx?|xlsx?))/gim;
  const out = new Set();

  (data || []).forEach(r => {
    const c = r.content || '';
    const matches = c.matchAll(re);
    for (const match of matches) {
      // match[1] contains the URL (first capture group)
      out.add(match[1]);
    }
  });

  return Array.from(out);
};
