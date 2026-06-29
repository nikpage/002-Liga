# CLAUDE.md - Project Context

## Interaction Style
- **Never use the AskUserQuestion tool.** Ask clarifying questions directly in plain text.
- **Do not discuss, refer to, or infer anything about the user, the user's feelings, or the user's state of mind in any way, shape, or form.** Stay strictly on the technical task. Do not comment on or characterize the user.

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

## Code Style & Constraints
- **Strict No-Refactor:** Do not refactor, clean up, or simplify code unless explicitly instructed.
- **Formatting:** Keep existing indentation and style.
- **Language:** The system is designed for Czech language processing (`cs-CZ`).
- **TTS Cleaning:** Text cleaning logic in `server.js` is critical for natural speech (removes headers, legal entities, parentheses).
