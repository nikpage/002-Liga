-- Run once in the Supabase SQL editor to enable typo-tolerant admin search.
-- Safe to re-run.

create extension if not exists pg_trgm;
create extension if not exists unaccent;

create index if not exists chunks_content_trgm_idx
  on chunks using gin (content gin_trgm_ops);

-- Matches the search text against each WORD inside a chunk (not the whole
-- chunk), so a typo in a short word still matches. Accent- and case-insensitive.
create or replace function search_chunks_fuzzy(search_text text)
returns setof chunks
language sql
stable
as $$
  select c.*
  from chunks c
  where exists (
    select 1
    from regexp_split_to_table(lower(unaccent(c.content)), '[^a-z0-9]+') as w(word)
    where w.word <> ''
      and (
        w.word like '%' || lower(unaccent(search_text)) || '%'
        or similarity(w.word, lower(unaccent(search_text))) > 0.3
      )
  )
  order by c.created_at desc
$$;
