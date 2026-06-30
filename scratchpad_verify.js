require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const sb = createClient(config.supabase.url, config.supabase.key);
(async () => {
  const { data } = await sb.from('chunks').select('source_url,content')
    .eq('source','facebook').like('content','%[Přepis videa]%').limit(2);
  for (const r of data||[]) {
    console.log('\nURL:', r.source_url);
    console.log(r.content.slice(-500));
  }
})();
