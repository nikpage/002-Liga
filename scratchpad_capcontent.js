const fetch = require('node-fetch');
const fs = require('fs');
const TOKEN = (process.env.FB_TOKEN || (fs.existsSync('fb-token.local') ? fs.readFileSync('fb-token.local','utf8').trim() : '')).trim();
const GRAPH = 'https://graph.facebook.com/v21.0';
const b = (p,params={}) => { const u = new URL(`${GRAPH}/${p}`); u.searchParams.set('access_token',TOKEN); for(const[k,v]of Object.entries(params))u.searchParams.set(k,v); return u.toString(); };
const j = async u => { const r = await fetch(u); return r.json(); };
(async () => {
  const ce = await j(b('1335142894725438/captions'));
  for (const c of ce.data||[]) {
    const txt = await (await fetch(c.uri)).text();
    console.log(`\n--- ${c.locale} (auto=${c.is_auto_generated}) ${txt.length} chars ---`);
    console.log(txt.slice(0,400));
  }
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
