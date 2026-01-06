module.exports = {
  provider: "google",

  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    tableName: "chunks"
  },
  google: {
    key: process.env.GOOGLE_API_KEY,
    embModel: "gemini-embedding-001",
    chatModel: "gemini-2.5-flash"
  },
  anthropic: {
    key: process.env.ANTHROPIC_API_KEY,
    chatModel: "claude-haiku-4-5"
  }
};
