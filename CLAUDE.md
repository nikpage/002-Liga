# CLAUDE.md - Project Context

## Interaction Style
- **Max 50 words per reply unless I explicitly ask for more.** Answer, then stop. No preamble, no summary, no restating my question.
- **No analysis dumps.** Don't list everything you considered. Give the answer or a short structured list. I ask the follow-ups.
- **Never use the AskUserQuestion tool.** Ask clarifying questions directly in plain text.
- **Do not discuss, refer to, or infer anything about the user, the user's feelings, or the user's state of mind in any way, shape, or form.** Stay strictly on the technical task. Do not comment on or characterize the user.

## Database Safety (LIVE production DB)
- **The Supabase DB (`chunks`, `chunk_history`) is LIVE production data serving real users. There is no casual undo.** Be extremely careful with every write/delete.
- **Before any DELETE/UPDATE, run a SELECT with the exact same filter first**, confirm the count, and confirm every matched row is test data only. State the destructive op in one plain line before running it.
- **Narrowest possible filter only** — never a broad `like`/`or` that could catch real rows. When unsure whether a row is real, stop and ask.
- **Test docs:** do NOT auto-clean test docs after each test. Tag them `source_url` like `example.com/claude-*`, leave them in place to verify the deletion flow, and sweep all of them in one pass right before client delivery.

## Commands
- **Start Server:** `npm start` or `node server.js`
- **Install Dependencies:** `npm install`
- **Port:** Defaults to `3000` (or `process.env.PORT`)
- **Ingest Facebook (manual):** `node scripts/ingest-facebook.js` (add `--dry-run` to preview the diff). Runs automatically daily via the cron in `server.js`.
- **Ingest website:** `node scripts/ingest-public.js`
- **Key env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`, `FB_TOKEN` (FB ingestion), `FB_CRON_DISABLED`/`FB_CRON_SCHEDULE` (cron control).

## Architecture
- **Backend:** Node.js + Express (`server.js`)
- **Frontend:** Vanilla HTML/JS (`index.html`)
- **Database:** Supabase (PostgreSQL with `pgvector` extension)
- **AI Logic:**
  - **Embeddings:** Google Gemini (`gemini-embedding-001`)
  - **Chat Generation:** Google Gemini (`gemini-2.5-flash`) OR Anthropic Claude (`claude-haiku-4-5`)
  - **TTS:** Google Cloud Text-to-Speech (`cs-CZ`, Female)
- **Search Logic:** RAG (Retrieval-Augmented Generation) via `search.js` and `database.js`

## Sources, Tags & eWay Save
- **Retrieval is never tag-limited.** `getFullContext` searches ALL sources (audiences). A question gets the most complete answer possible, including mixed-source (poradna + public) replies. Tags do NOT restrict which data can answer.
- **Tags** (`poradna_internal`, `public_web`, more to come) route the response *path* (which prompt) and internal bookkeeping — not data access.
- **eWay Journal save is source-driven, not tag-driven** (`search.js`): the answer is saved to eWay when it CITES a poradna source (any cited chunk with `audience === 'poradna_internal'`). Public-only answers are never saved. Mixed-source answers get poradna treatment (saved), because poradna answers are legally/grant-relevant and human-checked. See `eway-crm.js`.

## Admin page (`/admin`, served from `admin.html`)
Single-page admin with two tabs. UI is `admin.html`; KB data logic is `admin-chunks.js`; URL extraction is `fetch-extract.js`; routes are the `/api/admin/*` and `/api/qa-logs` handlers in `server.js`. **No auth layer** — access is by knowing the URL.

### Tab 1 — Q&A Log (read-only)
- Lists logged Q&A from the `qa_logs` table (`getQALogs` in `database.js`, written by `logQA`). `GET /api/qa-logs` (limit ≤ 5000). Shows #, date (cs-CZ), question, answer (Markdown-rendered, long answers collapsible).
- **Export to Excel** via SheetJS (`XLSX`, CDN) → `qa-log-<date>.xlsx`. No editing here; it's a viewer + export.

### Tab 2 — Znalostní báze (Knowledge Base — document management)
Manages rows in the `chunks` table. **A "document" = all chunks sharing a `source_url`** (base part before any `#anchor`); manual entries with no URL group by title/id (`groupDocuments`).
- **Search:** typo-tolerant, diacritic-insensitive fuzzy search via the pg_trgm-backed `search_chunks_fuzzy` RPC, with an exact `ilike` fallback if the function isn't installed (`listChunks`). Min 2 chars. Results are **grouped by document**, paginated **by document** (50/page). The UI highlights *why* each piece matched (client-side trigram scoring).
- **Source filters:** Poradna (`audience=poradna_internal`), Liga Web (`source=web`), Liga FB (`source=facebook`). All or none checked = no filter (`buildOrFilter`).
- **Add (`+ Nový záznam`) — URL-only, source-driven:** paste a URL; the server fetches it (`/api/admin/fetch-url` → `fetch-extract.js`), auto-detecting **HTML, PDF (`pdf-parse`), or Word `.docx` (`mammoth`)**, stripping page chrome and pulling YouTube captions for HTML. Text is cleaned (NUL/control chars stripped — PostgreSQL can't store NUL), chunked (~800 chars, ~100 overlap, same as the ingestion scripts), embedded per piece, and saved — with **live SSE progress** (chunking → embedding counter) via `POST /api/admin/chunks/stream`. New docs are stored as `source='web'`, `audience='public_web'`.
- **Duplicate handling (two stages):** (1) **same-URL check BEFORE fetch/embed** (`/api/admin/chunks/check-url` → `findByUrl`) so a straight re-add costs nothing if the user backs out; (2) **fuzzy near-duplicate check after embedding** for a *different* URL with ≥0.88 content similarity (`/check-replacement` → `findReplacementCandidate`). Either offers Replace / keep both / Cancel. **Replace ordering matters:** same-URL replace deletes the old copy *before* inserting (deleting after would wipe the new rows); different-URL replace inserts first then deletes the old (so a failed insert never loses the existing doc).
- **Edit (`Upravit`) — per chunk:** edit content/title/url/source/audience/event dates (`PUT /api/admin/chunks/:id` → `updateChunk`). Re-embeds only if content changed; no-op (no history row) if nothing changed.
- **Delete document (`Smazat dokument`) — per document:** removes every piece of the doc (`/api/admin/documents/delete` → `deleteDocument`); each piece is saved to history first, so it's recoverable.
- **Undo / history (`Vrátit zpět`) — per chunk:** shown only when a chunk has history (`enrichHistory`). Lists snapshots newest-first with action (`edit`/`delete`) + timestamp; Restore copies a snapshot back, **recreating the chunk if it had been deleted** (`/chunks/:id/restore/:historyId` → `restoreChunk`).
- **Versioning model:** history lives in `chunk_history`, keyed by **individual `chunk_id`** (not by document) — there is **no version number** and no document-level "restore to version N"; snapshots are distinguished by `created_at` + `action`. Capped at `MAX_HISTORY = 5` per chunk; the live/current state is in `chunks`, not history. A snapshot is written *before* each edit/delete (holds the pre-change state).

## Events
- **Recurring events** (`events.js`): the next DOBROklub date is computed in code from the "každý druhý čtvrtek v měsíci" recurrence rule, with Czech public-holiday checking (fixed dates + Easter). Injected into the prompt as an authoritative "COMPUTED UPCOMING EVENT" block so event questions never fail on phrasing.
- **`getFullContext` always injects** the recurrence-rule chunk and any currently-active `highlight_until` chunks, regardless of vector rank, so evergreen/active event info is never crowded out.
## Facebook ingestion (`scripts/ingest-facebook.js`)
- **Source of FB data** in the `chunks` table (`source='facebook'`, `audience='public_web'`). Pulls Liga's FB page via Graph API. Token from `FB_TOKEN` env or `fb-token.local` (a permanent page token).
- **Events = authoritative dates.** Marketing post captions rarely state the date; the Facebook **Event object** does. The script ingests `{page}/events` (`start_time`/`end_time`/`place`) → `event_date` = start, `highlight_until` = end, date written into the content text. **Only upcoming/ongoing events are ingested** (past events skipped — recap posts cover history). Upcoming events surface via the `highlight_until` injection in `getFullContext` until they pass.
- **Posts** ingest with `event_date` = post date; service announcements get a 30-day `highlight_until` window.
- **Liga comments on upcoming events:** for upcoming/live events only, posts formally attached to the event (FB event attachment `target.id`) have their **Liga-authored** comments (`from.id === page.id`) ingested, tied to the event window (auto-pruned after). Capture is sparse (Liga rarely comments on the event-attached post); broader name-window matching is possible but adds cost.
- **Incremental & idempotent:** diffs fetched items against stored rows (`source_url` → content); embeds only new/changed, prunes orphans, leaves unchanged rows untouched. Exits free when nothing's new. `--dry-run` prints the diff (cheap "anything new?" check). Never touches website/eWay/poradna rows.
- **Automatic:** a daily in-process cron in `server.js` (node-cron, ~05:00 server time) spawns the script. Knobs: `FB_CRON_SCHEDULE`, `FB_CRON_DISABLED=true`. Other FB helper scripts: `fb-permatoken.js` (token exchange), `fb-scan.js`, `fb-comments.js` (audit).

## Audience: generous matching
- Users include people with motor and cognitive impairments and non-Czech speakers. Input is often misspelled, terse, or mixed-language. **Never let a query fail for being messy** — prefer always-include fallbacks and generous thresholds over strict matching. Test with deliberately messy phrasings.

## Key Files
- `server.js`: Main entry point, API routes (`/search`, `/tts`), and text cleaning logic.
- `ai-client.js`: Handles all external AI API calls (Google, Anthropic).
- `search.js`: Orchestrates the RAG flow (Embed -> DB Search -> Prompt -> Generate); decides eWay save by cited sources.
- `database.js`: `getFullContext` (vector search + event/highlight injection + audience tagging), `logQA`.
- `events.js`: Computes next recurring-event date (DOBROklub) + Czech public-holiday check.
- `prompts.js`: Public and Poradna prompts, formatting rules, computed-event injection.
- `eway-crm.js`: Writes poradna Q&A to eWay-CRM as a Journal entry.
- `scripts/ingest-facebook.js`: Incremental FB ingestion (events + posts + Liga event-comments); run daily by the cron in `server.js`.
- `scripts/ingest-public.js`: Website (sitemap) ingestion into `chunks`.
- `config.js`: Central configuration for API keys and models.
- `admin.html`: Admin SPA — Q&A Log tab (viewer + Excel export) and Znalostní báze tab (KB document management UI).
- `admin-chunks.js`: KB document-management DB logic (grouped search, create/edit/delete, duplicate detection, per-chunk history/restore).
- `fetch-extract.js`: Fetches a URL and extracts readable text for manual ingestion — HTML (chrome-stripped + YouTube captions), PDF (`pdf-parse`), Word `.docx` (`mammoth`).

## Code Style & Constraints
- **Strict No-Refactor:** Do not refactor, clean up, or simplify code unless explicitly instructed.
- **Formatting:** Keep existing indentation and style.
- **Language:** The system is designed for Czech language processing (`cs-CZ`).
- **TTS Cleaning:** Text cleaning logic in `server.js` is critical for natural speech (removes headers, legal entities, parentheses).
