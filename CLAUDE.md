# CLAUDE.md - Project Context

## Commands
- **Start Server:** `npm start` or `node server.js`
- **Install Dependencies:** `npm install`
- **Port:** Defaults to `3000` (or `process.env.PORT`)

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
- **FB event data** is stored under `audience='public_web'` with `event_date` (currently the post date) and `highlight_until` columns. Reliable per-event upcoming dates require the (external, not-in-repo) FB scraper to parse real event dates — open work.

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
- `config.js`: Central configuration for API keys and models.

## Code Style & Constraints
- **Strict No-Refactor:** Do not refactor, clean up, or simplify code unless explicitly instructed.
- **Formatting:** Keep existing indentation and style.
- **Language:** The system is designed for Czech language processing (`cs-CZ`).
- **TTS Cleaning:** Text cleaning logic in `server.js` is critical for natural speech (removes headers, legal entities, parentheses).
