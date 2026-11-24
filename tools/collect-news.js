#!/usr/bin/env node
// Collect news articles from outlets' RSS/Atom feeds, GDELT and public
// Telegram channels (t.me/s/<channel> web previews) into one
// news.json for the static site. Run every 15 minutes by the public site's
// GitHub Actions workflow (deploy/pages.yml), free and with no AI.
//
//   node scripts/collect-news.js [--sources news.sources.json]
//     [--hierarchy topics.hierarchy.example.json] [--node geopolitics]
//     [--previous <url or file of the last news.json>] [--out news.json]
//     [--hours 48] [--no-gdelt] [--no-feeds] [--no-telegram]
//
// Feeds only carry their latest 20-50 items, so each run merges with the
// previous news.json and keeps the last `--hours`. Only articles from listed
// outlets that match the topic hierarchy (under --node) are kept.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHierarchy } from '../src/hierarchy.js?v=72b3fdad1a';
import { makeOutlets, mergeArticles, parseFeed, parseGdelt, parseTelegram, telegramOutlets } from '../src/news.js?v=72b3fdad1a';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'InTheLoopNewsCollector/0.1 (+https://partox131.github.io/in-the-loop-briefing/)';
const GDELT = 'https://api.gdeltproject.org/api/v2/doc/doc';
const TELEGRAM_GAP_MS = 1_000; // one channel page a second, politely
const GDELT_GAP_MS = 10_000; // GDELT asks for at most one request every 5 seconds
// GDELT lists articles about 1 to 2 hours after publication, so a query
// must look back further than that (news.sources.json: timespan 4h).

function args(argv) {
  const o = { sources: join(root, 'news.sources.json'), hierarchy: join(root, 'topics.hierarchy.example.json'), node: 'geopolitics', out: 'news.json', hours: 48, gdelt: true, feeds: true, telegram: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-gdelt') o.gdelt = false;
    else if (a === '--no-feeds') o.feeds = false;
    else if (a === '--no-telegram') o.telegram = false;
    else if (a.startsWith('--')) o[a.slice(2)] = argv[++i];
  }
  o.hours = Number(o.hours);
  return o;
}

async function get(url, { fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  const res = await fetchImpl(url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Run tasks with at most `n` at a time. */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function collectNews({ spec, hierarchy, node = 'geopolitics', previous = null, now = new Date(), hours = 48, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), gdelt = true, feeds = true, telegram = true }) {
  const channels = spec.telegram?.channels || [];
  const tgOutlets = telegramOutlets(channels);
  const outlets = makeOutlets([...spec.outlets, ...tgOutlets]);
  const report = [];
  const found = [];

  if (feeds) {
    const jobs = spec.outlets.flatMap((o) => (o.feeds || []).map((url) => ({ o, url })));
    await pool(jobs, 6, async ({ o, url }) => {
      try {
        const items = parseFeed(await get(url, { fetchImpl }));
        found.push(...items.map((a) => ({ ...a, via: ['rss'] })));
        report.push({ kind: 'rss', outlet: o.domain, url, ok: items.length > 0, items: items.length, ...(items.length ? {} : { error: 'no items' }) });
      } catch (err) {
        report.push({ kind: 'rss', outlet: o.domain, url, ok: false, items: 0, error: String(err.message || err) });
      }
    });
  }

  if (gdelt && spec.gdelt?.queries?.length) {
    const g = spec.gdelt;
    for (const [i, q] of g.queries.entries()) {
      if (i) await sleep(GDELT_GAP_MS);
      const params = new URLSearchParams({ query: q.query, mode: 'artlist', format: 'json', sort: 'datedesc', maxrecords: String(g.maxrecords || 250), timespan: g.timespan || '1h' });
      const url = `${GDELT}?${params}`;
      let entry = { kind: 'gdelt', id: q.id, ok: false, items: 0, listed: 0 };
      // GitHub's runners share addresses, so GDELT sometimes says 429 even when we wait: back off and retry.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const body = await get(url, { fetchImpl, timeoutMs: 30_000 });
          // GDELT answers rate limits and bad queries with plain text, not JSON.
          const items = parseGdelt(JSON.parse(body));
          const listed = items.filter((a) => outlets.forUrl(a.url));
          found.push(...listed.map((a) => ({ ...a, via: ['gdelt'] })));
          entry = { kind: 'gdelt', id: q.id, ok: true, items: items.length, listed: listed.length };
          break;
        } catch (err) {
          entry.error = String(err.message || err).slice(0, 200);
          if (attempt < 2) await sleep(GDELT_GAP_MS * 3 * (attempt + 1));
        }
      }
      report.push(entry);
    }
  }

  if (telegram && channels.length) {
    for (const [i, c] of channels.entries()) {
      if (i) await sleep(TELEGRAM_GAP_MS);
      const url = `https://t.me/s/${c.channel}`;
      try {
        const { verified, posts } = parseTelegram(await get(url, { fetchImpl }));
        found.push(...posts.map((a) => ({ ...a, language: c.language, via: ['telegram'] })));
        // A channel that turns its preview off redirects to its info page: no posts.
        report.push({ kind: 'telegram', outlet: `t.me/${c.channel.toLowerCase()}`, url, ok: posts.length > 0, items: posts.length, verified, ...(posts.length ? {} : { error: 'no posts (preview off or channel gone?)' }) });
      } catch (err) {
        report.push({ kind: 'telegram', outlet: `t.me/${c.channel.toLowerCase()}`, url, ok: false, items: 0, error: String(err.message || err) });
      }
    }
  }

  const cutoff = now.getTime() - hours * 3_600_000;
  const fresh = found
    .filter((a) => outlets.forUrl(a.url))
    // A feed item without a date: first seen now (kept stable by the merge with previous runs).
    .map((a) => ({ ...a, published: a.published || now.toISOString() }))
    .filter((a) => Date.parse(a.published) <= now.getTime() + 10 * 60_000)
    .filter((a) => hierarchy.classify({ text: `${a.title}. ${a.summary || ''}`, tags: [], langs: ['en'] }, node).length > 0);
  const kept = mergeArticles(previous?.articles || [], fresh)
    .filter((a) => outlets.forUrl(a.url) && Date.parse(a.published) >= cutoff)
    .sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
    .slice(0, 4000)
    .map(({ title, url, summary, published, via, views, links, language }) => ({ title, url, summary, published, via, ...(views != null ? { views } : {}), ...(links?.length ? { links } : {}), ...(language ? { language } : {}) }));

  return {
    generatedAt: now.toISOString(),
    about: 'News articles for In the Loop, collected from outlet RSS feeds, GDELT and public Telegram channels every 15 minutes. Only listed outlets and channels, only items matching the topic hierarchy. Telegram posts are short excerpts linking to the post; Telegram content must not be used with AI (Telegram terms).',
    hours,
    outlets: [...spec.outlets.map(({ feeds: _f, ...o }) => o), ...tgOutlets],
    sources: report.sort((a, b) => (a.kind + (a.outlet || a.id)).localeCompare(b.kind + (b.outlet || b.id))),
    articles: kept,
  };
}

async function readPrevious(where) {
  if (!where) return null;
  try {
    const text = /^https?:\/\//.test(where) ? await get(`${where}?t=${Date.now()}`) : readFileSync(where, 'utf8');
    return JSON.parse(text);
  } catch (err) {
    console.warn(`No previous news.json (${err.message}); starting fresh.`);
    return null;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2));
  const spec = JSON.parse(readFileSync(o.sources, 'utf8'));
  const hierarchy = makeHierarchy(JSON.parse(readFileSync(o.hierarchy, 'utf8')));
  const previous = await readPrevious(o.previous);
  const doc = await collectNews({ spec, hierarchy, node: o.node, previous, hours: o.hours, gdelt: o.gdelt, feeds: o.feeds, telegram: o.telegram });
  writeFileSync(o.out, JSON.stringify(doc));
  const ok = doc.sources.filter((s) => s.ok).length;
  console.log(`news.json: ${doc.articles.length} articles; ${ok} of ${doc.sources.length} sources answered.`);
  for (const s of doc.sources.filter((x) => !x.ok)) console.log(`  failed: ${s.kind} ${s.outlet || s.id} ${s.url || ''} ${s.error || ''}`);
}
