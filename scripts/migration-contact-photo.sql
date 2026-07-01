-- Run once in the Supabase SQL editor. Safe to re-run.
-- Lets a chunk carry a contact's name + photo URL (scraped alongside their
-- phone/email block during public-site ingestion) so the chat UI can render
-- an attractive contact card instead of plain text.

alter table chunks
  add column if not exists contact_name text,
  add column if not exists contact_image_url text;
