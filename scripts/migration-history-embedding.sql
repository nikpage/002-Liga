-- Run once in the Supabase SQL editor. Safe to re-run.
-- Stores the embedding vector with each history version so restoring a
-- version copies the exact original vector back instead of recomputing it.

alter table chunk_history
  add column if not exists embedding vector(1536);
