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

// Source filter categories -> a PostgREST predicate. Poradna is identified by
// audience; the others by source. All (or none) selected means no filtering.
const FILTER_PREDICATES = {
    poradna: 'audience.eq.poradna_internal',
    web: 'source.eq.web',
    fb: 'source.eq.facebook'
};
function buildOrFilter(filters) {
    if (!Array.isArray(filters)) return null;
    const keys = filters.filter(k => FILTER_PREDICATES[k]);
    if (keys.length === 0 || keys.length === Object.keys(FILTER_PREDICATES).length) return null;
    return keys.map(k => FILTER_PREDICATES[k]).join(',');
}

// Group matching chunks into documents, keyed by the document URL (the part
// before any #anchor); manual entries with no URL fall back to title/id.
function groupDocuments(chunks) {
    const groups = [];
    const byKey = new Map();
    for (const c of chunks) {
        const base = (c.source_url || '').split('#')[0];
        const key = base || (c.document_title ? 'title:' + c.document_title : 'id:' + c.id);
        let g = byKey.get(key);
        if (!g) {
            g = { key, source_url: base || null, document_title: c.document_title || null, audience: c.audience, source: c.source, pieces: [] };
            byKey.set(key, g);
            groups.push(g);
        }
        g.pieces.push(c);
    }
    return groups;
}

// Mark which pieces actually have saved history, so the UI only offers "undo"
// where there is something to undo.
async function enrichHistory(pieces) {
    const ids = pieces.map(p => p.id);
    if (!ids.length) return;
    const { data } = await supabase.from(HISTORY).select('chunk_id').in('chunk_id', ids);
    const withHist = new Set((data || []).map(r => r.chunk_id));
    for (const p of pieces) p.has_history = withHist.has(p.id);
}

// Run a query, group results into documents, paginate by document.
async function searchGrouped(buildQuery, offset, limit) {
    const { data, error } = await buildQuery();
    if (error) return { error };
    const groups = groupDocuments(data || []);
    const page = groups.slice(offset, offset + limit);
    await enrichHistory(page.flatMap(g => g.pieces));
    return { documents: page, total: groups.length };
}

// offset/limit are document-based here (one "row" = one document).
exports.listChunks = async (search, offset = 0, limit = 50, filters = []) => {
    const orFilter = buildOrFilter(filters);
    if (search) {
        // Typo-tolerant fuzzy search via the pg_trgm-backed DB function.
        const res = await searchGrouped(() => {
            let fq = supabase.rpc('search_chunks_fuzzy', { search_text: search }).select(CHUNK_COLS).limit(2000);
            if (orFilter) fq = fq.or(orFilter);
            return fq;
        }, offset, limit);
        if (!res.error) return res;
        // Fallback: function not installed yet -> exact search, still grouped.
        const res2 = await searchGrouped(() => {
            let q = supabase.from(TABLE).select(CHUNK_COLS).order('created_at', { ascending: false }).ilike('content', `%${search}%`).limit(2000);
            if (orFilter) q = q.or(orFilter);
            return q;
        }, offset, limit);
        if (!res2.error) return res2;
        throw res2.error;
    }
    // No search term (not used by the current UI): plain ungrouped list.
    let q = supabase
        .from(TABLE)
        .select(CHUNK_COLS, { count: 'exact' })
        .order('created_at', { ascending: false });
    if (orFilter) q = q.or(orFilter);
    q = q.range(offset, offset + limit - 1);
    const { data, error, count } = await q;
    if (error) throw error;
    return { documents: [], chunks: data || [], total: count };
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

// Same sizes as the website ingestion (scripts/ingest-facebook.js / ingest-public.js)
// so a manually-added document is chunked consistently with crawled content.
const TARGET_CHUNK_SIZE = 800;
const OVERLAP_SIZE = 100;

// Break an over-long block into <=max word-bounded pieces.
function splitLong(s, max) {
    const out = [];
    while (s.length > max) {
        let cut = s.lastIndexOf(' ', max);
        if (cut <= 0) cut = max;
        out.push(s.slice(0, cut).trim());
        s = s.slice(cut).trim();
    }
    if (s) out.push(s);
    return out;
}

// Split plain text into ~800-char chunks at paragraph/word boundaries, carrying
// ~100 chars of overlap between them (mirrors chunkBlocks in ingest-public.js).
function chunkText(text) {
    const clean = (text || '').replace(/\r\n/g, '\n').trim();
    if (!clean) return [];
    if (clean.length <= TARGET_CHUNK_SIZE) return [clean];

    const blocks = [];
    for (const b of clean.split(/\n+/).map(x => x.trim()).filter(Boolean)) {
        if (b.length > TARGET_CHUNK_SIZE) blocks.push(...splitLong(b, TARGET_CHUNK_SIZE));
        else blocks.push(b);
    }

    const chunks = [];
    let buffer = '';
    const flush = () => {
        const c = buffer.trim();
        if (!c) return;
        chunks.push(c);
        if (c.length > OVERLAP_SIZE) {
            const tail = c.slice(-OVERLAP_SIZE);
            const at = tail.search(/\s/);
            buffer = (at >= 0 ? tail.slice(at + 1) : tail) + ' ';
        } else {
            buffer = '';
        }
    };
    for (const b of blocks) {
        const piece = b + '\n';
        if (buffer.length + piece.length > TARGET_CHUNK_SIZE && buffer.trim()) flush();
        buffer += piece;
    }
    flush();
    return chunks;
}

// How many pieces a given text will be split into (for the add-from-URL preview).
exports.countChunks = (text) => chunkText(text).length;

// onProgress (optional) is called as the document is processed so the UI can
// show live chunking/embedding progress:
//   { phase: 'chunking', total }              once, after splitting
//   { phase: 'embedding', done, total }       after each piece is embedded
exports.createChunk = async ({ content, document_title, source_url, source, audience, event_date, highlight_until }, onProgress) => {
    const pieces = chunkText(content);
    if (pieces.length === 0) { const e = new Error('Obsah je prázdný – není co uložit.'); e.userFacing = true; throw e; }
    if (onProgress) onProgress({ phase: 'chunking', total: pieces.length });
    const base = {
        document_title: document_title || null,
        source_url: source_url || null,
        source: source || 'manual',
        audience: audience || 'public_web',
        event_date: event_date || null,
        highlight_until: highlight_until || null
    };
    // Embed every piece first; if any embedding fails we insert nothing, so a
    // document is never saved half-embedded.
    const rows = [];
    let done = 0;
    for (const piece of pieces) {
        const embedding = await getEmb(piece);
        rows.push({ content: piece, ...base, embedding, chunk_index: done });
        done++;
        if (onProgress) onProgress({ phase: 'embedding', done, total: pieces.length });
    }
    const { data, error } = await supabase
        .from(TABLE)
        .insert(rows)
        .select('id, content, document_title, source_url, source, audience, event_date, highlight_until, created_at');
    if (error) throw error;
    return { count: data.length, chunks: data };
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

// Look for an existing document that this content appears to be a newer version
// of: high embedding similarity, but a different URL. Returns the best candidate
// above the threshold, or null. Fail-safe: if the DB function isn't installed,
// returns no candidate so adding still works.
const REPLACEMENT_MIN_SIMILARITY = 0.88;
// Is this exact URL already stored? URL-only lookup (no fetch, no embedding)
// so the add flow can warn about a straight duplicate BEFORE doing any work.
// Returns the existing document's info as a candidate (exact: true), or null.
exports.findByUrl = async (url) => {
    if (!url) return { candidate: null };
    const base = url.split('#')[0];
    const [exact, frag] = await Promise.all([
        supabase.from(TABLE).select('document_title, audience, source').eq('source_url', base).limit(1),
        supabase.from(TABLE).select('document_title, audience, source').like('source_url', `${base}#%`).limit(1)
    ]);
    const hit = (exact.data && exact.data[0]) || (frag.data && frag.data[0]);
    if (!hit) return { candidate: null };
    return { candidate: {
        source_url: base,
        document_title: hit.document_title || null,
        audience: hit.audience || null,
        source: hit.source || null,
        similarity: 1,
        exact: true
    } };
};

exports.findReplacementCandidate = async (content, sourceUrl) => {
    const pieces = chunkText(content);
    if (pieces.length === 0) return { candidate: null };
    const probe = await getEmb(pieces[0]);
    const { data, error } = await supabase.rpc('find_similar_chunks', {
        probe,
        exclude_url: sourceUrl || null,
        match_count: 20
    });
    if (error || !data) return { candidate: null };

    const probeBase = (sourceUrl || '').split('#')[0];
    const byDoc = new Map();
    for (const row of data) {
        const base = (row.source_url || '').split('#')[0];
        if (!base || (probeBase && base === probeBase)) continue;
        const cur = byDoc.get(base);
        if (!cur || row.similarity > cur.similarity) byDoc.set(base, { ...row, base });
    }
    let best = null;
    for (const v of byDoc.values()) if (!best || v.similarity > best.similarity) best = v;
    if (!best || best.similarity < REPLACEMENT_MIN_SIMILARITY) return { candidate: null };
    return { candidate: {
        source_url: best.base,
        document_title: best.document_title || null,
        audience: best.audience || null,
        source: best.source || null,
        similarity: best.similarity
    } };
};

// Delete a whole document (every piece sharing this URL, including #anchored
// chunks). Each piece is saved to history first, so the delete is recoverable.
exports.deleteDocument = async (url) => {
    if (!url) return { deleted: 0 };
    const cols = 'id, content, document_title, source_url, source, audience, event_date, highlight_until';
    const [exact, frag] = await Promise.all([
        supabase.from(TABLE).select(cols).eq('source_url', url),
        supabase.from(TABLE).select(cols).like('source_url', `${url}#%`)
    ]);
    const map = new Map();
    for (const r of (exact.data || [])) map.set(r.id, r);
    for (const r of (frag.data || [])) map.set(r.id, r);
    const rows = [...map.values()];
    for (const r of rows) {
        const emb = await getEmbeddingFor(r.id);
        await saveHistory({ ...r, embedding: emb }, 'delete');
    }
    if (rows.length) {
        const { error } = await supabase.from(TABLE).delete().in('id', rows.map(r => r.id));
        if (error) throw error;
    }
    return { deleted: rows.length };
};

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
