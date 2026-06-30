require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const sb = createClient(config.supabase.url, config.supabase.key);
(async () => {
  const { count: done } = await sb.from('chunks').select('id',{count:'exact',head:true})
    .eq('source','facebook').like('content','%[Přepis videa]%');
  const { count: total } = await sb.from('chunks').select('id',{count:'exact',head:true})
    .eq('source','facebook').or('source_url.like.%/reel/%,source_url.like.%/videos/%');
  console.log(`transcribed: ${done} / ${total} FB videos`);
})();
