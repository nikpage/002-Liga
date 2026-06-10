const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(
  config.supabase.url,
  config.supabase.key
);

exports.getFullContext = async (embedding, query, audienceFilter = null) => {
  const { data, error } = await supabase.rpc('match_chunks', {
    query_embedding: embedding,
    match_threshold: 0.45,
    match_count: 30,
    audience_filter: audienceFilter
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

exports.logQA = (question, answer) => {
  supabase.from('qa_logs').insert({ question, answer }).then(({ error }) => {
    if (error) console.error("QA LOG ERROR:", error);
  });
};

exports.getQALogs = async (limit = 500, offset = 0) => {
  const { data, error, count } = await supabase
    .from('qa_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("QA LOGS FETCH ERROR:", error);
    throw error;
  }

  return { logs: data || [], total: count };
};

exports.getAudienceCounts = async () => {
  const { data, error } = await supabase
    .from(config.supabase.tableName)
    .select('audience');

  if (error) {
    console.error("AUDIENCE FETCH ERROR:", error);
    throw error;
  }

  const counts = {};
  (data || []).forEach(r => {
    const key = r.audience === null ? 'null' : r.audience;
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
};
