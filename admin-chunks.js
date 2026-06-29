const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const { getEmb } = require('./ai-client');

const supabase = createClient(config.supabase.url, config.supabase.key);
const TABLE = 'chunks';
const HISTORY = 'chunk_history';
const MAX_HISTORY = 5;

async function saveHistory(chunk, action) {
    await supabase.from(HISTORY).insert({
        chunk_id: chunk.id,
        content: chunk.content,
        document_title: chunk.document_title,
        source_url: chunk.source_url,
        source: chunk.source,
        audience: chunk.audience,
        event_date: chunk.event_date,
        highlight_until: chunk.highlight_until,
        embedding: chunk.embedding ?? null,
        action
    });
    // Prune to MAX_HISTORY versions per chunk
    const { data: rows } = await supabase
        .from(HISTORY)
        .select('id')
        .eq('chunk_id', chunk.id)
        .order('created_at', { ascending: false });
    if (rows && rows.length > MAX_HISTORY) {
        const toDelete = rows.slice(MAX_HISTORY).map(r => r.id);
        await supabase.from(HISTORY).delete().in('id', toDelete);
    }
}

const CHUNK_COLS = 'id, content, document_title, source_url, source, audience, event_date, highlight_until, created_at';

// Fetch just the stored embedding vector for a chunk (kept out of the normal
// SELECT list so the large vector isn't sent to the browser unnecessarily).
async function getEmbeddingFor(id) {
    const { data } = await supabase.from(TABLE).select('embedding').eq('id', id).single();
    return data ? data.embedding : null;
}

exports.listChunks = async (search, offset = 0, limit = 50) => {
    if (search) {
        // Typo-tolerant fuzzy search via the pg_trgm-backed DB function.
        const fuzzy = await supabase
            .rpc('search_chunks_fuzzy', { search_text: search }, { count: 'exact' })
            .select(CHUNK_COLS)
            .range(offset, offset + limit - 1);
        if (!fuzzy.error) {
            return { chunks: fuzzy.data || [], total: fuzzy.count };
        }
        // Fallback: function not installed yet -> keep exact search working.
    }
    let q = supabase
        .from(TABLE)
        .select(CHUNK_COLS, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
    if (search) q = q.ilike('content', `%${search}%`);
    const { data, error, count } = await q;
    if (error) throw error;
    return { chunks: data || [], total: count };
};

exports.getChunk = async (id) => {
    const { data, error } = await supabase
        .from(TABLE)
        .select('id, content, document_title, source_url, source, audience, event_date, highlight_until, created_at')
        .eq('id', id)
        .single();
    if (error) throw error;
    return data;
};

exports.createChunk = async ({ content, document_title, source_url, source, audience, event_date, highlight_until }) => {
    const embedding = await getEmb(content);
    const { data, error } = await supabase
        .from(TABLE)
        .insert({ content, document_title, source_url, source: source || 'manual', audience: audience || 'public_web', event_date: event_date || null, highlight_until: highlight_until || null, embedding })
        .select('id, content, document_title, source_url, source, audience, event_date, highlight_until, created_at')
        .single();
    if (error) throw error;
    return data;
};

const EDITABLE_FIELDS = ['content', 'document_title', 'source_url', 'source', 'audience', 'event_date', 'highlight_until'];

// Normalize a field value for change-detection. Empty -> null; date fields
// compared by calendar day so a stored timestamp vs. a 'YYYY-MM-DD' input
// doesn't register as a phantom change.
function normVal(field, v) {
    if (v === undefined || v === null || v === '') return null;
    if (field === 'event_date' || field === 'highlight_until') return String(v).split('T')[0];
    return v;
}

exports.updateChunk = async (id, fields) => {
    const existing = await exports.getChunk(id);
    const changed = EDITABLE_FIELDS.some(f => f in fields && normVal(f, fields[f]) !== normVal(f, existing[f]));
    // Nothing actually changed -> don't write an identical history version.
    if (!changed) return existing;
    const prevEmbedding = await getEmbeddingFor(id);
    await saveHistory({ ...existing, embedding: prevEmbedding }, 'edit');
    const update = { ...fields };
    if (fields.content && fields.content !== existing.content) {
        update.embedding = await getEmb(fields.content);
    }
    const { data, error } = await supabase
        .from(TABLE)
        .update(update)
        .eq('id', id)
        .select('id, content, document_title, source_url, source, audience, event_date, highlight_until, created_at')
        .single();
    if (error) throw error;
    return data;
};

exports.deleteChunk = async (id) => {
    const existing = await exports.getChunk(id);
    const prevEmbedding = await getEmbeddingFor(id);
    await saveHistory({ ...existing, embedding: prevEmbedding }, 'delete');
    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) throw error;
};

exports.getHistory = async (id) => {
    const { data, error } = await supabase
        .from(HISTORY)
        .select('id, chunk_id, content, document_title, source_url, source, audience, event_date, highlight_until, action, created_at')
        .eq('chunk_id', id)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
};

exports.restoreChunk = async (chunkId, historyId) => {
    const { data: hRow, error: hErr } = await supabase
        .from(HISTORY)
        .select('*')
        .eq('id', historyId)
        .eq('chunk_id', chunkId)
        .single();
    if (hErr) throw hErr;

    // Check if the original chunk still exists
    const { data: existing } = await supabase.from(TABLE).select('id').eq('id', chunkId).single();

    if (existing) {
        const cur = await exports.getChunk(chunkId);
        const curEmbedding = await getEmbeddingFor(chunkId);
        await saveHistory({ ...cur, embedding: curEmbedding }, 'edit');
        // Reuse the stored vector; only recompute for old history rows saved
        // before embeddings were kept in history.
        const embedding = hRow.embedding ?? await getEmb(hRow.content);
        const { data, error } = await supabase
            .from(TABLE)
            .update({ content: hRow.content, document_title: hRow.document_title, source_url: hRow.source_url, source: hRow.source, audience: hRow.audience, event_date: hRow.event_date, highlight_until: hRow.highlight_until, embedding })
            .eq('id', chunkId)
            .select('id, content, document_title, source_url, source, audience, event_date, highlight_until, created_at')
            .single();
        if (error) throw error;
        return data;
    } else {
        // Chunk was deleted — recreate it
        const embedding = hRow.embedding ?? await getEmb(hRow.content);
        const { data, error } = await supabase
            .from(TABLE)
            .insert({ content: hRow.content, document_title: hRow.document_title, source_url: hRow.source_url, source: hRow.source, audience: hRow.audience, event_date: hRow.event_date, highlight_until: hRow.highlight_until, embedding })
            .select('id, content, document_title, source_url, source, audience, event_date, highlight_until, created_at')
            .single();
        if (error) throw error;
        return data;
    }
};
