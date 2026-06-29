-- Run once in the Supabase SQL editor to enable typo-tolerant admin search.
-- Safe to re-run.

create extension if not exists pg_trgm;
create extension if not exists unaccent;

create index if not exists chunks_content_trgm_idx
  on chunks using gin (content gin_trgm_ops);

-- Match rule (accent- and case-insensitive):
--   * the query is split into tokens; tokens shorter than 2 chars are ignored
--     (so "sexy" never matches stray words like "s" or "se");
--   * EVERY query token must be matched by some word in the content;
--   * a content word matches a token if it CONTAINS the token, or is a genuine
--     close typo of it (similar length AND trigram similarity > 0.4) — not just
--     a short fragment of it.
create or replace function search_chunks_fuzzy(search_text text)
returns setof chunks
language sql
stable
as $$
  with q as (
    select array(
      select tok
      from regexp_split_to_table(lower(unaccent(search_text)), '[^a-z0-9]+') as tok
      where length(tok) >= 2
    ) as tokens
  )
  select c.*
  from chunks c, q
  where array_length(q.tokens, 1) is not null
    and not exists (
      -- a query token with no matching word in this chunk -> chunk excluded
      select 1
      from unnest(q.tokens) as qt
      where not exists (
        select 1
        from regexp_split_to_table(lower(unaccent(c.content)), '[^a-z0-9]+') as w(word)
        where w.word <> ''
          and (
            w.word like '%' || qt || '%'
            or (abs(length(w.word) - length(qt)) <= 2 and similarity(w.word, qt) > 0.4)
          )
      )
    )
  order by c.created_at desc
$$;
