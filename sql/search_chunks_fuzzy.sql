-- Run once in the Supabase SQL editor to enable typo-tolerant admin search.
-- Safe to re-run.

create extension if not exists pg_trgm;

-- Trigram index makes fuzzy matching fast.
create index if not exists chunks_content_trgm_idx
  on chunks using gin (content gin_trgm_ops);

-- Returns rows of the chunks table, ranked by closeness to the search text.
-- Matches exact substrings AND close-enough (typo) matches.
create or replace function search_chunks_fuzzy(search_text text)
returns setof chunks
language sql
stable
as $$
  select *
  from chunks
  where content ilike '%' || search_text || '%'
     or similarity(content, search_text) > 0.1
     or content % search_text
  order by similarity(content, search_text) desc nulls last,
           created_at desc
$$;
