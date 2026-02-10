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

## Key Files
- `server.js`: Main entry point, API routes (`/search`, `/tts`), and text cleaning logic.
- `ai-client.js`: Handles all external AI API calls (Google, Anthropic).
- `search.js`: Orchestrates the RAG flow (Embed -> DB Search -> Prompt -> Generate).
- `prompts.js`: Contains the system prompt and formatting rules.
- `config.js`: Central configuration for API keys and models.

## Code Style & Constraints
- **Strict No-Refactor:** Do not refactor, clean up, or simplify code unless explicitly instructed.
- **Formatting:** Keep existing indentation and style.
- **Language:** The system is designed for Czech language processing (`cs-CZ`).
- **TTS Cleaning:** Text cleaning logic in `server.js` is critical for natural speech (removes headers, legal entities, parentheses).
