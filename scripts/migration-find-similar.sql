-- Run once in the Supabase SQL editor. Safe to re-run.
-- Used by the admin add-flow to detect when a newly-added document looks like a
-- newer version of an existing one (high content similarity, different URL).
-- Returns the closest chunks to a probe embedding with a 0..1 similarity score.

create or replace function find_similar_chunks(probe vector(1536), exclude_url text, match_count int)
returns table (
  source_url text,
  document_title text,
  audience text,
  source text,
  similarity double precision
)
language sql
stable
as $$
  select
    source_url,
    document_title,
    audience,
    source,
    1 - (embedding <=> probe) as similarity
  from chunks
  where embedding is not null
    and (exclude_url is null or source_url is distinct from exclude_url)
  order by embedding <=> probe
  limit match_count
$$;
