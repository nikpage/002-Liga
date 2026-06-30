#!/usr/bin/env node
// Read-only check: confirms fb-token.local works WITHOUT ever printing the token.
// Loads the token inside this process, calls the Graph API, and prints only the
// page name/id and a masked token (last 4 chars). The token value never leaves
// this process and never reaches the chat/logs.
const fetch = require('node-fetch');
const fs = require('fs');

const token = (process.env.FB_TOKEN ||
  (fs.existsSync('fb-token.local') ? fs.readFileSync('fb-token.local', 'utf8').trim() : '')).trim();
if (!token) { console.error('No token in fb-token.local or FB_TOKEN.'); process.exit(1); }

const masked = `…${token.slice(-4)} (${token.length} chars)`;

(async () => {
  const r = await fetch(`https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${token}`);
  const j = await r.json();
  if (j.error) {
    // Strip the token out of any echoed URL before printing.
    console.log(`Token ${masked}: INVALID — ${String(j.error.message).replace(/access_token=[\w.-]+/g, 'access_token=REDACTED')}`);
    process.exit(2);
  }
  // /me on a page token returns the page itself; on a user token returns the user.
  const acc = await fetch(`https://graph.facebook.com/v21.0/me/accounts?fields=id,name&access_token=${token}`);
  const aj = await acc.json();
  const pages = (aj.data || []).map(p => `${p.name} (${p.id})`).join(', ') || '(none — this is a PAGE token, not a user token)';
  console.log(`Token ${masked}: VALID`);
  console.log(`  /me        -> ${j.name} (${j.id})`);
  console.log(`  manages    -> ${pages}`);
})().catch(e => { console.error('ERROR:', String(e.message).replace(/access_token=[\w.-]+/g, 'access_token=REDACTED')); process.exit(1); });
