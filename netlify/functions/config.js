module.exports = {
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    tableName: "document_chunks" 
  },
  google: {
    key: process.env.GOOGLE_API_KEY,
    embModel: "gemini-embedding-001",
    chatModel: "gemini-2.0-flash-lite"
  }
};
