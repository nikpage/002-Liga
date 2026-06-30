const fetch = require('node-fetch');
const fs = require('fs');
const TOKEN = (process.env.FB_TOKEN || (fs.existsSync('fb-token.local') ? fs.readFileSync('fb-token.local','utf8').trim() : '')).trim();
const GRAPH = 'https://graph.facebook.com/v21.0';
const b = (p,params={}) => { const u = new URL(`${GRAPH}/${p}`); u.searchParams.set('access_token',TOKEN); for(const[k,v]of Object.entries(params))u.searchParams.set(k,v); return u.toString(); };
const j = async u => { const r = await fetch(u); return r.json(); };
(async () => {
  const me = await j(b('me',{fields:'id'}));
  const vids = await j(b(`${me.id}/videos`,{fields:'id,length,created_time,updated_time',limit:'15'}));
  console.log('id | created | len(s) | #captionTracks | locales(auto?)');
  for (const v of vids.data||[]) {
    const ce = await j(b(`${v.id}/captions`));
    const caps = (ce.data||[]);
    const locs = caps.map(c=>`${c.locale}${c.is_auto_generated?'(a)':''}${c.is_default?'*':''}`).join(',');
    console.log(`${v.id} | ${(v.created_time||'').slice(0,10)} | ${v.length||'?'} | ${caps.length} | ${locs||'-'}`);
  }
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
