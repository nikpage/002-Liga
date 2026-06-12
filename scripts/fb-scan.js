#!/usr/bin/env node
// Facebook page audit: counts posts + comments by month/year and dumps text for review.
// Usage:  FB_TOKEN=your_page_token  node scripts/fb-scan.js
// Optional: PAGE_ID=123...  (otherwise it uses the first page your token manages)

const fetch = require('node-fetch');
const fs = require('fs');

const USER_TOKEN = process.env.FB_TOKEN ||
  (fs.existsSync('fb-token.local') ? fs.readFileSync('fb-token.local', 'utf8').trim() : null);
const GRAPH = 'https://graph.facebook.com/v21.0';

if (!USER_TOKEN) {
  console.error('Missing FB_TOKEN. Run:  FB_TOKEN=your_token node scripts/fb-scan.js');
  process.exit(1);
}

// Starts as the user token; replaced with the page token once we resolve the page.
let TOKEN = USER_TOKEN;

async function api(path, params = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  url.searchParams.set('access_token', TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

async function resolvePageId() {
  const me = await api('me/accounts', { fields: 'id,name,access_token' });
  if (!me.data || me.data.length === 0) throw new Error('No managed pages found for this token.');
  let page = me.data[0];
  if (process.env.PAGE_ID) page = me.data.find(p => p.id === process.env.PAGE_ID) || page;
  console.log(`Using page: ${page.name} (${page.id})`);
  // Switch to the page's own token for reading its posts and comments.
  if (page.access_token) TOKEN = page.access_token;
  return page.id;
}

async function getJson(fullUrl) {
  const res = await fetch(fullUrl);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

async function getAllPosts(pageId) {
  const posts = [];
  const first = new URL(`${GRAPH}/${pageId}/posts`);
  first.searchParams.set('access_token', TOKEN);
  first.searchParams.set('fields', 'id,created_time,message');
  first.searchParams.set('limit', '100');

  let url = first.toString();
  while (url) {
    const page = await getJson(url);
    for (const p of page.data || []) posts.push(p);
    process.stdout.write(`\r  fetched ${posts.length} posts...`);
    url = (page.paging && page.paging.next) ? page.paging.next : null;
  }
  process.stdout.write('\n');
  return posts;
}

async function getCommentCount(postId) {
  try {
    const r = await api(`${postId}/comments`, { summary: 'true', limit: 0 });
    return (r.summary && r.summary.total_count) || 0;
  } catch {
    return 0;
  }
}

function ym(dateStr) {
  const d = new Date(dateStr);
  return { year: d.getFullYear(), month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` };
}

async function main() {
  const pageId = await resolvePageId();
  const posts = await getAllPosts(pageId);

  const byYear = {};
  const byMonth = {};
  let totalComments = 0;
  const lines = [];

  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const { year, month } = ym(p.created_time);
    const comments = await getCommentCount(p.id);
    totalComments += comments;

    byYear[year] = byYear[year] || { posts: 0, comments: 0 };
    byYear[year].posts++; byYear[year].comments += comments;
    byMonth[month] = byMonth[month] || { posts: 0, comments: 0 };
    byMonth[month].posts++; byMonth[month].comments += comments;

    lines.push(`[${p.created_time}] comments:${comments}\n${(p.message || '(no text)').replace(/\n/g, ' ')}\n`);
    process.stdout.write(`\r  scanned ${i + 1}/${posts.length} posts...`);
  }
  process.stdout.write('\n\n');

  console.log('=== POSTS & COMMENTS BY YEAR ===');
  for (const y of Object.keys(byYear).sort()) {
    console.log(`${y}:  ${byYear[y].posts} posts, ${byYear[y].comments} comments`);
  }
  console.log('\n=== BY MONTH ===');
  for (const m of Object.keys(byMonth).sort()) {
    console.log(`${m}:  ${byMonth[m].posts} posts, ${byMonth[m].comments} comments`);
  }
  console.log(`\nTOTAL: ${posts.length} posts, ${totalComments} comments`);

  fs.writeFileSync('fb-scan-output.txt', lines.join('\n'));
  console.log('\nFull post text written to fb-scan-output.txt (review it to flag what should NOT go into the AI).');
}

main().catch(err => { console.error('\nERROR:', err.message); process.exit(1); });
