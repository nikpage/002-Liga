#!/usr/bin/env node
// Scan Liga FB page for video posts in the last 3 months.
// Dumps caption, attachment type, permalink, and thumbnail URL.
// Usage:  node scripts/fb-video-scan.js
// Output: fb-video-scan-output.txt

const fetch = require('node-fetch');
const fs = require('fs');

const TOKEN_RAW = process.env.FB_TOKEN ||
  (fs.existsSync('fb-token.local') ? fs.readFileSync('fb-token.local', 'utf8').trim() : null);

if (!TOKEN_RAW) {
  console.error('Missing FB_TOKEN or fb-token.local');
  process.exit(1);
}

const GRAPH = 'https://graph.facebook.com/v21.0';
let TOKEN = TOKEN_RAW;

const SINCE = new Date();
SINCE.setMonth(SINCE.getMonth() - 3);
const SINCE_ISO = SINCE.toISOString().split('T')[0];

async function getJson(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

function build(path, params = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  url.searchParams.set('access_token', TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

async function resolvePage() {
  try {
    const me = await getJson(build('me', { fields: 'id,name' }));
    if (me.id) { console.log(`Page: ${me.name} (${me.id})`); return me.id; }
  } catch (_) {}
  const acc = await getJson(build('me/accounts', { fields: 'id,name,access_token' }));
  if (!acc.data || !acc.data.length) throw new Error('No managed pages found.');
  const page = acc.data[0];
  if (page.access_token) TOKEN = page.access_token;
  console.log(`Page: ${page.name} (${page.id})`);
  return page.id;
}

async function paginate(startUrl) {
  const items = [];
  let url = startUrl;
  while (url) {
    const page = await getJson(url);
    for (const item of page.data || []) items.push(item);
    url = page.paging && page.paging.next ? page.paging.next : null;
  }
  return items;
}

async function main() {
  const pageId = await resolvePage();
  console.log(`Scanning from ${SINCE_ISO} …\n`);

  // 1. Posts with video attachments
  const posts = await paginate(build(`${pageId}/posts`, {
    fields: 'id,created_time,message,permalink_url,attachments{type,media{source,image},title,description}',
    limit: '100',
    since: SINCE_ISO,
  }));

  // 2. Dedicated /videos endpoint (sometimes returns different set)
  const videos = await paginate(build(`${pageId}/videos`, {
    fields: 'id,created_time,description,permalink_url,thumbnails{uri},title',
    limit: '25',
    since: SINCE_ISO,
  }));

  const lines = [];
  let videoPostCount = 0;

  lines.push(`=== POSTS WITH VIDEO ATTACHMENTS (since ${SINCE_ISO}) ===\n`);
  for (const p of posts) {
    const atts = (p.attachments && p.attachments.data) || [];
    const vidAtts = atts.filter(a => a.type && (a.type.includes('video') || a.type.includes('share')));
    if (!vidAtts.length) continue;
    videoPostCount++;

    const date = p.created_time.slice(0, 10);
    const caption = (p.message || '').replace(/\n/g, ' ').slice(0, 300);
    const types = vidAtts.map(a => a.type).join(', ');
    const thumb = vidAtts.map(a => a.media && a.media.image && a.media.image.src).filter(Boolean).join(' | ');

    lines.push(`[${date}] type:${types}`);
    lines.push(`  caption: ${caption || '(none)'}`);
    if (thumb) lines.push(`  thumbnail: ${thumb}`);
    lines.push(`  url: ${p.permalink_url || ''}`);
    lines.push('');
  }
  lines.push(`Total video posts: ${videoPostCount}\n`);

  lines.push(`\n=== /videos ENDPOINT (since ${SINCE_ISO}) ===\n`);
  for (const v of videos) {
    const date = v.created_time ? v.created_time.slice(0, 10) : '?';
    const caption = (v.description || v.title || '').replace(/\n/g, ' ').slice(0, 300);
    const thumb = v.thumbnails && v.thumbnails.data && v.thumbnails.data[0] && v.thumbnails.data[0].uri;
    lines.push(`[${date}] ${v.title || '(no title)'}`);
    lines.push(`  caption: ${caption || '(none)'}`);
    if (thumb) lines.push(`  thumbnail: ${thumb}`);
    lines.push(`  url: ${v.permalink_url || v.id}`);
    lines.push('');
  }
  lines.push(`Total from /videos: ${videos.length}`);

  const out = lines.join('\n');
  fs.writeFileSync('fb-video-scan-output.txt', out);
  console.log(out);
  console.log('\nWritten to fb-video-scan-output.txt');
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
