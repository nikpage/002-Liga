require('dotenv').config();
const fetch = require('node-fetch');
const fs = require('fs');
const { execSync } = require('child_process');
const cfg = require('./config').google;
const TOKEN = (process.env.FB_TOKEN || (fs.existsSync('fb-token.local') ? fs.readFileSync('fb-token.local','utf8').trim() : '')).trim();
const GRAPH = 'https://graph.facebook.com/v21.0';
const b = (p,params={}) => { const u = new URL(`${GRAPH}/${p}`); u.searchParams.set('access_token',TOKEN); for(const[k,v]of Object.entries(params))u.searchParams.set(k,v); return u.toString(); };
const j = async u => { const r = await fetch(u); return r.json(); };
const TMP = process.env.SCRATCH || '/tmp/claude-1000/-home-nik-repos-002-Liga/ded12afb-da47-4ce6-85f5-73add7ff5d0f/scratchpad';

(async () => {
  const me = await j(b('me',{fields:'id'}));
  const vids = await j(b(`${me.id}/videos`,{fields:'id,source,length,created_time',limit:'5'}));
  const v = (vids.data||[]).find(x => x.length > 25) || vids.data[0];
  console.log(`Test video ${v.id} (${v.length}s, ${v.created_time.slice(0,10)})`);

  // 1. download mp4
  const t0 = Date.now();
  const buf = Buffer.from(await (await fetch(v.source)).arrayBuffer());
  const mp4 = `${TMP}/clip.mp4`; fs.writeFileSync(mp4, buf);
  console.log(`Downloaded ${(buf.length/1e6).toFixed(2)} MB in ${Date.now()-t0}ms`);

  // 2. extract audio -> mono 16k mp3
  const mp3 = `${TMP}/clip.mp3`;
  execSync(`ffmpeg -y -i "${mp4}" -vn -ac 1 -ar 16000 -b:a 64k "${mp3}" 2>/dev/null`);
  const audio = fs.readFileSync(mp3);
  console.log(`Audio extracted: ${(audio.length/1e3).toFixed(0)} KB`);

  // 3. Gemini transcribe (inline base64 audio)
  const body = {
    contents: [{ parts: [
      { text: 'Přepiš přesně mluvené slovo z tohoto audia do češtiny. Vrať pouze čistý přepis, žádný komentář.' },
      { inline_data: { mime_type: 'audio/mp3', data: audio.toString('base64') } }
    ]}]
  };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.chatModel}:generateContent?key=${cfg.key}`,
    { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const out = await res.json();
  if (out.error) { console.error('GEMINI ERROR:', JSON.stringify(out.error)); process.exit(1); }
  const text = out.candidates?.[0]?.content?.parts?.map(p=>p.text).join('') || '(empty)';
  console.log('\n===== TRANSCRIPT =====\n' + text);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
