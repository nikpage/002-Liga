const { createClient } = require('@supabase/supabase-js');
const { supabase: cfg } = require('./config');

function getSupabaseClient() {
  return createClient(cfg.url, cfg.key);
}

async function getFullContext(vector, query) {
  try {
    const client = getSupabaseClient();
    const { data, error } = await client.rpc('match_document_chunks', {
      query_embedding: vector,
      match_threshold: 0.15,
      match_count: 30
    });

    if (error) throw error;

    const chunks = data.map(row => {
      let content = row.content;
      try {
        const parsed = JSON.parse(content);
        if (parsed.entity && parsed.municipality) {
          let readable = `Organizace: ${parsed.entity}, Místo: ${parsed.municipality}`;
          if (parsed.features && Array.isArray(parsed.features)) {
            readable += `, Pomůcky: ${parsed.features.join(', ')}`;
          }
          if (parsed.address) readable += `, Adresa: ${parsed.address}`;
          if (parsed.phone) readable += `, Telefon: ${parsed.phone}`;
          if (parsed.email) readable += `, Email: ${parsed.email}`;
          if (parsed.note) readable += `, Poznámka: ${parsed.note}`;
          content = readable;
        }
      } catch (e) {}

      return {
        id: row.id,
        text: content,
        title: row.document_title,
        url: row.source_url
      };
    });

    return { chunks };
  } catch (error) {
    console.error("Database error:", error);
    throw error;
  }
}

module.exports = { getFullContext };
