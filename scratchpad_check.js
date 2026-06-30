require('dotenv').config();
const fetch = require('node-fetch');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const config = require('./config');
const TOKEN = (process.env.FB_TOKEN || (fs.existsSync('fb-token.local') ? fs.readFileSync('fb-token.local','utf8').trim() : '')).trim();
const GRAPH = 'https://graph.facebook.com/v21.0';
const b = (p,params={}) => { const u = new URL(`${GRAPH}/${p}`); u.searchParams.set('access_token',TOKEN); for(const[k,v]of Object.entries(params))u.searchParams.set(k,v); return u.toString(); };
const j = async u => (await fetch(u)).json();
const sb = createClient(config.supabase.url, config.supabase.key);
(async () => {
  const me = await j(b('me',{fields:'id'}));
  const vids = await j(b(`${me.id}/videos`,{fields:'id,permalink_url,length,created_time',limit:'5'}));
  console.log('=== sample /videos permalinks ===');
  for (const v of vids.data||[]) console.log(` ${v.id} len=${v.length} -> ${v.permalink_url}`);

  // total FB video/reel rows + how many lack transcript
  const { count: total } = await sb.from('chunks').select('id',{count:'exact',head:true}).eq('source','facebook').like('source_url','%/reel/%');
  const { count: missing } = await sb.from('chunks').select('id',{count:'exact',head:true}).eq('source','facebook').like('source_url','%/reel/%').not('content','like','%[Přepis videa]%');
  console.log(`\nFB reel chunks total: ${total}, missing transcript: ${missing}`);

  // also check /videos style permalinks present? (some may be /videos/ or /watch)
  const { count: vidsCol } = await sb.from('chunks').select('id',{count:'exact',head:true}).eq('source','facebook').like('source_url','%/videos/%');
  console.log(`FB chunks with /videos/ url: ${vidsCol}`);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
