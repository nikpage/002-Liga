-- Run once in Supabase SQL editor to create the chunk_history table.

CREATE TABLE IF NOT EXISTS chunk_history (
    id          bigserial PRIMARY KEY,
    chunk_id    bigint NOT NULL,
    content     text,
    document_title text,
    source_url  text,
    source      text,
    audience    text,
    event_date  timestamptz,
    highlight_until timestamptz,
    action      text NOT NULL CHECK (action IN ('edit', 'delete')),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chunk_history_chunk_id ON chunk_history(chunk_id);
CREATE INDEX IF NOT EXISTS idx_chunk_history_created_at ON chunk_history(created_at DESC);
