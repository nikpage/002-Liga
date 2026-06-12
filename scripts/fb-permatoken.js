#!/usr/bin/env node
// Turn a short-lived token into a PERMANENT page token and save it to fb-token.local.
// Page tokens derived from a long-lived user token do not expire.
//
// Inputs via env: APP_SECRET (required), SHORT (required, fresh user token from Explorer),
//                 APP_ID (optional, defaults to the liga-scan app), PAGE_ID (optional)
const fetch = require('node-fetch');
const fs = require('fs');
const readline = require('readline');

const APP_ID = process.env.APP_ID || '1333622618722431';
const GRAPH = 'https://graph.facebook.com/v21.0';

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim()); }));
}

async function getJson(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

async function main() {
  const APP_SECRET = process.env.APP_SECRET || await ask('Paste app secret, press Enter: ');
  const SHORT = process.env.SHORT || await ask('Paste token, press Enter: ');
  if (!APP_SECRET || !SHORT) throw new Error('App secret and token are both required.');

  // 1) short-lived user token -> long-lived user token (~60 days)
  const ex = await getJson(`${GRAPH}/oauth/access_token?grant_type=fb_exchange_token` +
    `&client_id=${APP_ID}&client_secret=${encodeURIComponent(APP_SECRET)}` +
    `&fb_exchange_token=${encodeURIComponent(SHORT)}`);
  const longUser = ex.access_token;
  if (!longUser) throw new Error('No long-lived user token returned.');

  // 2) page token from the long-lived user token -> this one does NOT expire
  const me = await getJson(`${GRAPH}/me/accounts?fields=id,name,access_token&access_token=${longUser}`);
  if (!me.data || !me.data.length) throw new Error('No managed pages found.');
  let page = me.data[0];
  if (process.env.PAGE_ID) page = me.data.find(p => p.id === process.env.PAGE_ID) || page;
  if (!page.access_token) throw new Error('No page access token returned.');

  fs.writeFileSync('fb-token.local', page.access_token);
  console.log(`Permanent page token saved to fb-token.local for: ${page.name} (${page.id})`);
  console.log('This token does not expire. You will not need to regenerate it.');
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
