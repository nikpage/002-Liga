const fetch = require('node-fetch');
const fs = require('fs');
const TOKEN = (process.env.FB_TOKEN || (fs.existsSync('fb-token.local') ? fs.readFileSync('fb-token.local','utf8').trim() : '')).trim();
const GRAPH = 'https://graph.facebook.com/v21.0';
const b = (p,params={}) => { const u = new URL(`${GRAPH}/${p}`); u.searchParams.set('access_token',TOKEN); for(const[k,v]of Object.entries(params))u.searchParams.set(k,v); return u.toString(); };
const j = async u => { const r = await fetch(u); const x = await r.json(); if(x.error) throw new Error(JSON.stringify(x.error)); return x; };
(async () => {
  const me = await j(b('me',{fields:'id,name'}));
  console.log('Page:', me.name, me.id);
  const vids = await j(b(`${me.id}/videos`,{fields:'id,title,created_time',limit:'10'}));
  const list = vids.data || [];
  console.log('Got', list.length, 'videos. Probing captions on each:');
  for (const v of list) {
    let res = '';
    try {
      const c = await j(b(v.id,{fields:'captions'}));
      const caps = c.captions && c.captions.data;
      if (caps && caps.length) {
        res = 'CAPTIONS: ' + caps.map(x=>x.locale).join(',');
        // fetch first vtt to prove text exists
        try { const t = await (await fetch(caps[0].uri)).text(); res += ' | vtt chars=' + t.length; } catch(e){ res+=' | vtt fetch fail'; }
      } else res = 'no captions field/empty';
    } catch(e) { res = 'ERR ' + e.message.slice(0,120); }
    console.log(` - ${v.id} [${(v.created_time||'').slice(0,10)}] ${(v.title||'').slice(0,30)} => ${res}`);
  }
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
