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

  let chunks = data || [];

  // Events (DOBROklub rule, FB highlights) live under 'public_web'. They are
  // relevant to every caller — including the internal poradna tool, which the
  // website UI actually uses — so the evergreen event injections below always
  // include public event data on top of the caller's own audience.
  const eventAudiences = audienceFilter
    ? Array.from(new Set([...audienceFilter, 'public_web']))
    : null;

  // Always include currently-highlighted chunks (active events) even when they
  // rank too low in vector search to make the top-N. The match_chunks RPC is
  // pure semantic similarity and ignores highlight_until, so an active event
  // post can otherwise be crowded out by older, more on-topic chunks.
  try {
    const nowIso = new Date().toISOString();
    let hlQuery = supabase
      .from('chunks')
      .select('id, content, document_title, source_url, downloads, source, highlight_until')
      .gte('highlight_until', nowIso)
      .order('highlight_until', { ascending: true });
    if (eventAudiences) hlQuery = hlQuery.in('audience', eventAudiences);

    const { data: highlighted, error: hlError } = await hlQuery;
    if (hlError) {
      console.error("HIGHLIGHT QUERY ERROR:", hlError);
    } else if (highlighted && highlighted.length) {
      const hlById = new Map(highlighted.map(c => [c.id, c]));
      // Stamp highlight_until on chunks already returned by the RPC so the
      // "currently active" marker survives (the RPC doesn't return that field).
      chunks = chunks.map(c =>
        hlById.has(c.id) ? { ...c, highlight_until: hlById.get(c.id).highlight_until } : c
      );
      // Prepend the active highlights the RPC missed entirely.
      const seen = new Set(chunks.map(c => c.id));
      const fresh = highlighted.filter(c => !seen.has(c.id));
      chunks = fresh.concat(chunks);
    }
  } catch (hlErr) {
    console.error("HIGHLIGHT MERGE ERROR:", hlErr.message);
  }

  // Always include the recurring-events rule chunk (DOBROklub "každý druhý
  // čtvrtek v měsíci"). It's an evergreen constant the events note depends on,
  // but vector search only surfaces it for some phrasings — a generic or
  // misspelled "next event" query misses it, leaving the model with no data.
  try {
    let ruleQuery = supabase
      .from('chunks')
      .select('id, content, document_title, source_url, downloads, source')
      .ilike('content', '%druhý čtvrtek v měsíci%');
    if (eventAudiences) ruleQuery = ruleQuery.in('audience', eventAudiences);

    const { data: ruleChunks, error: ruleError } = await ruleQuery;
    if (ruleError) {
      console.error("EVENTS RULE QUERY ERROR:", ruleError);
    } else if (ruleChunks && ruleChunks.length) {
      const seen = new Set(chunks.map(c => c.id));
      const fresh = ruleChunks.filter(c => !seen.has(c.id));
      chunks = fresh.concat(chunks);
    }
  } catch (ruleErr) {
    console.error("EVENTS RULE MERGE ERROR:", ruleErr.message);
  }

  // Attach each chunk's audience (the match_chunks RPC doesn't return it) so
  // callers can tell which sources actually built the answer — e.g. to give
  // any answer that cites a poradna source the poradna (eWay-saved) treatment.
  try {
    const ids = chunks.map(c => c.id).filter(id => id !== undefined);
    if (ids.length) {
      const { data: audRows, error: audError } = await supabase
        .from('chunks')
        .select('id, audience')
        .in('id', ids);
      if (audError) {
        console.error("AUDIENCE LOOKUP ERROR:", audError);
      } else if (audRows) {
        const audById = new Map(audRows.map(r => [r.id, r.audience]));
        chunks = chunks.map(c => ({ ...c, audience: audById.get(c.id) }));
      }
    }
  } catch (audErr) {
    console.error("AUDIENCE MERGE ERROR:", audErr.message);
  }

  return { chunks };
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
