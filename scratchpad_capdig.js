const fetch = require('node-fetch');
const fs = require('fs');
const TOKEN = (process.env.FB_TOKEN || (fs.existsSync('fb-token.local') ? fs.readFileSync('fb-token.local','utf8').trim() : '')).trim();
const GRAPH = 'https://graph.facebook.com/v21.0';
const b = (p,params={}) => { const u = new URL(`${GRAPH}/${p}`); u.searchParams.set('access_token',TOKEN); for(const[k,v]of Object.entries(params))u.searchParams.set(k,v); return u.toString(); };
const j = async u => { const r = await fetch(u); const x = await r.json(); return x; };

const HAS = '1335142894725438';   // the one WITH captions
const NONE = '2753645585015062';  // one without

(async () => {
  for (const id of [HAS, NONE]) {
    console.log('\n===== VIDEO', id, '=====');
    // rich field set
    const f = await j(b(id,{fields:'id,title,description,created_time,length,is_reference_only,published,captions,captions_locales,content_category,custom_labels'}));
    console.log('fields:', JSON.stringify(f,null,1).slice(0,1200));
    // captions as an EDGE (different from field)
    const ce = await j(b(`${id}/captions`));
    console.log('captions EDGE:', JSON.stringify(ce).slice(0,800));
  }
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
