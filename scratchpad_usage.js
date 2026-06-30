require('dotenv').config();
const fetch = require('node-fetch');
const fs = require('fs');
const { execSync } = require('child_process');
const cfg = require('./config').google;
const TOKEN = (process.env.FB_TOKEN || (fs.existsSync('fb-token.local') ? fs.readFileSync('fb-token.local','utf8').trim() : '')).trim();
const GRAPH = 'https://graph.facebook.com/v21.0';
const b = (p,params={}) => { const u = new URL(`${GRAPH}/${p}`); u.searchParams.set('access_token',TOKEN); for(const[k,v]of Object.entries(params))u.searchParams.set(k,v); return u.toString(); };
const j = async u => (await fetch(u)).json();
const TMP = '/tmp/claude-1000/-home-nik-repos-002-Liga/ded12afb-da47-4ce6-85f5-73add7ff5d0f/scratchpad';
(async () => {
  const me = await j(b('me',{fields:'id'}));
  const vids = await j(b(`${me.id}/videos`,{fields:'id,source,length',limit:'5'}));
  const v = (vids.data||[]).find(x=>x.length>25)||vids.data[0];
  const buf = Buffer.from(await (await fetch(v.source)).arrayBuffer());
  fs.writeFileSync(`${TMP}/u.mp4`, buf);
  execSync(`ffmpeg -y -i "${TMP}/u.mp4" -vn -ac 1 -ar 16000 -b:a 64k "${TMP}/u.mp3" 2>/dev/null`);
  const audio = fs.readFileSync(`${TMP}/u.mp3`);
  const body = { contents:[{ parts:[
    { text:'Přepiš přesně mluvené slovo do češtiny. Vrať jen čistý přepis.' },
    { inline_data:{ mime_type:'audio/mp3', data: audio.toString('base64') } } ]}] };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.chatModel}:generateContent?key=${cfg.key}`,
    { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const out = await res.json();
  console.log('model:', cfg.chatModel);
  console.log('video length (s):', v.length);
  console.log('usageMetadata:', JSON.stringify(out.usageMetadata, null, 1));
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
