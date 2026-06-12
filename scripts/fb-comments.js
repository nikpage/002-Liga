#!/usr/bin/env node
// Facebook page comment audit: pulls comment TEXT, finds user questions, keeps fun/engagement stats.
// Additive — does not touch fb-scan-output.txt.
// Usage:  FB_TOKEN=your_token  node scripts/fb-comments.js
// Optional: PAGE_ID=123...   MIN_COMMENTS=5  (default 5: only posts with >=5 comments)

const fetch = require('node-fetch');
const fs = require('fs');

const USER_TOKEN = process.env.FB_TOKEN ||
  (fs.existsSync('fb-token.local') ? fs.readFileSync('fb-token.local', 'utf8').trim() : null);
const GRAPH = 'https://graph.facebook.com/v21.0';
const MIN_COMMENTS = parseInt(process.env.MIN_COMMENTS || '5', 10);

if (!USER_TOKEN) {
  console.error('Missing FB_TOKEN. Run:  FB_TOKEN=your_token node scripts/fb-comments.js');
  process.exit(1);
}

let TOKEN = USER_TOKEN;
let PAGE_ID = null;

async function getJson(fullUrl) {
  const res = await fetch(fullUrl);
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
  const me = await getJson(build('me/accounts', { fields: 'id,name,access_token' }));
  if (!me.data || !me.data.length) throw new Error('No managed pages found.');
  let page = me.data[0];
  if (process.env.PAGE_ID) page = me.data.find(p => p.id === process.env.PAGE_ID) || page;
  console.log(`Using page: ${page.name} (${page.id})`);
  if (page.access_token) TOKEN = page.access_token;
  PAGE_ID = page.id;
}

async function getAllPosts() {
  const posts = [];
  // reactions.summary gives the like/heart count (fun stats); comments.summary gives the count cheaply.
  let url = build(`${PAGE_ID}/posts`, {
    fields: 'id,created_time,message,reactions.summary(true).limit(0),comments.summary(true).limit(0)',
    limit: '100'
  });
  while (url) {
    const page = await getJson(url);
    for (const p of page.data || []) posts.push(p);
    process.stdout.write(`\r  listed ${posts.length} posts...`);
    url = page.paging && page.paging.next ? page.paging.next : null;
  }
  process.stdout.write('\n');
  return posts;
}

async function getComments(postId) {
  const out = [];
  let url = build(`${postId}/comments`, {
    fields: 'id,from,message,created_time,like_count',
    limit: '100',
    order: 'chronological'
  });
  while (url) {
    const page = await getJson(url);
    for (const c of page.data || []) out.push(c);
    url = page.paging && page.paging.next ? page.paging.next : null;
  }
  return out;
}

function isQuestion(text) {
  if (!text) return false;
  if (text.includes('?')) return true;
  // common Czech question openers without a question mark
  return /\b(kdy|kde|kolik|jak|jaké|jaká|jaký|jestli|můžu|můžeme|lze|je možné|prosím o info)\b/i.test(text);
}

async function main() {
  await resolvePage();
  const posts = await getAllPosts();
  const targets = posts.filter(p => (p.comments?.summary?.total_count || 0) >= MIN_COMMENTS);
  console.log(`\nPosts with >=${MIN_COMMENTS} comments: ${targets.length}\n`);

  let totalUser = 0, totalLigaReplies = 0, totalReactions = 0;
  const questions = [];
  const funniest = []; // most-liked user comments
  const lines = [];

  for (let i = 0; i < posts.length; i++) totalReactions += posts[i].reactions?.summary?.total_count || 0;

  for (let i = 0; i < targets.length; i++) {
    const p = targets[i];
    const comments = await getComments(p.id);
    lines.push(`\n========== POST ${p.created_time} | reactions:${p.reactions?.summary?.total_count || 0} ==========`);
    lines.push((p.message || '(no text)').replace(/\n/g, ' '));
    for (const c of comments) {
      const isLiga = c.from && c.from.id === PAGE_ID;
      const who = isLiga ? 'LIGA' : 'USER';
      if (isLiga) totalLigaReplies++; else totalUser++;
      const msg = (c.message || '').replace(/\n/g, ' ');
      lines.push(`  [${who} | likes:${c.like_count || 0}] ${msg}`);
      if (!isLiga && isQuestion(msg)) questions.push(`(${p.created_time}) ${msg}`);
      if (!isLiga && (c.like_count || 0) >= 2) funniest.push({ likes: c.like_count, msg });
    }
    process.stdout.write(`\r  pulled comments for ${i + 1}/${targets.length} posts...`);
  }
  process.stdout.write('\n\n');

  console.log('=== ENGAGEMENT / FUN STATS ===');
  console.log(`Total reactions (likes/hearts) across all posts: ${totalReactions}`);
  console.log(`User comments read: ${totalUser}`);
  console.log(`Liga replies read: ${totalLigaReplies}`);
  console.log(`\n=== USER QUESTIONS FOUND: ${questions.length} ===`);
  questions.slice(0, 40).forEach(q => console.log('  ? ' + q));
  if (questions.length > 40) console.log(`  ...and ${questions.length - 40} more (see file)`);

  console.log('\n=== LIVELIEST USER COMMENTS (most liked) ===');
  funniest.sort((a, b) => b.likes - a.likes).slice(0, 10).forEach(f => console.log(`  (${f.likes}) ${f.msg}`));

  lines.push('\n\n===== ALL USER QUESTIONS =====');
  questions.forEach(q => lines.push('? ' + q));
  fs.writeFileSync('fb-comments-output.txt', lines.join('\n'));
  console.log('\nFull comment text + all questions written to fb-comments-output.txt');
}

main().catch(err => { console.error('\nERROR:', err.message); process.exit(1); });
