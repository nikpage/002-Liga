const fetch = require('node-fetch');
const fs = require('fs');
const TOKEN = (process.env.FB_TOKEN || (fs.existsSync('fb-token.local') ? fs.readFileSync('fb-token.local','utf8').trim() : '')).trim();
const GRAPH = 'https://graph.facebook.com/v21.0';
const b = (p,params={}) => { const u = new URL(`${GRAPH}/${p}`); u.searchParams.set('access_token',TOKEN); for(const[k,v]of Object.entries(params))u.searchParams.set(k,v); return u.toString(); };
const j = async u => { const r = await fetch(u); const x = await r.json(); if(x.error) throw new Error(JSON.stringify(x.error)); return x; };
(async () => {
  const me = await j(b('me',{fields:'id,name'}));
  const vids = await j(b(`${me.id}/videos`,{fields:'id,source,title,created_time',limit:'5'}));
  for (const v of vids.data||[]) {
    let info = '';
    if (v.source) {
      try { const h = await fetch(v.source, {method:'GET', headers:{Range:'bytes=0-0'}}); info = `source OK http=${h.status} type=${h.headers.get('content-type')} len=${h.headers.get('content-range')||h.headers.get('content-length')}`; }
      catch(e){ info='source fetch ERR '+e.message.slice(0,60); }
    } else info = 'NO source field';
    console.log(` - ${v.id} [${(v.created_time||'').slice(0,10)}] => ${info}`);
  }
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
