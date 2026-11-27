#!/usr/bin/env node
// Count which sources feed the briefing site, for the "Resource breakdown"
// dashboard. Runs the same pipeline as the static page (the voices' Bluesky
// posts plus the site's news.json, kept for one topic node) and writes three
// CSV files and a meta.json. Run once a day by the public site's workflow
// (deploy/stats.yml), free and with no AI.
//
//   node scripts/resource-stats.js [--news <url or file of news.json>]
//     [--voices voices.example.json] [--hierarchy topics.hierarchy.example.json]
//     [--node geopolitics] [--out stats]
//
// items.csv    one row per source, channel, region covered and window
//              ("Last 24 hours" or "24 to 48 hours ago"), with item counts
// hourly.csv   items per UTC hour and channel over the last 48 hours
// outlets.csv  every listed news outlet with its RSS feeds' last result
// sources.csv  every configured source (RSS outlets, Telegram channels,
//              Bluesky voices) with link, status and item counts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BskyClient } from '../src/bsky.js?v=bc7b86b967';
import { buildBrief } from '../src/brief.js?v=bc7b86b967';
import { makeHierarchy } from '../src/hierarchy.js?v=bc7b86b967';
import { newsPosts } from '../src/news.js?v=bc7b86b967';
import { TIER_NAME, makeVoice } from '../src/voices.js?v=bc7b86b967';
import { stateCountry } from '../src/flags.js?v=bc7b86b967';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOUR = 3_600_000;
const ROLE = Object.fromEntries(Object.entries(TIER_NAME).map(([k, v]) => [k, v === 'OSINT' ? v : v[0].toUpperCase() + v.slice(1)]));
const COVERAGE = { 'middle-east': 'Middle East', 'eastern-europe': 'Ukraine, Russia and NATO east', 'east-asia': 'China and Taiwan' };
const FEED_STATUS = ['Working', 'Partly failing', 'Failing', 'No RSS feed'];

/**
 * Turn the briefing's posts into the dashboard's rows.
 * @param {object} o
 * @param {Array} o.posts      the brief's posts (Bluesky posts and news articles, each with did, handle, node, createdAt)
 * @param {Array} o.voices     voices with did, as resolved for the brief
 * @param {Array} o.outlets    news.json's outlets
 * @param {Array} [o.sources]  news.json's per-feed report
 */
export function resourceStats({ posts, voices, outlets, sources = [], now = new Date() }) {
  const byDid = new Map(voices.filter((v) => v.did).map((v) => [v.did, v]));
  const byDomain = new Map(outlets.map((o) => [o.domain, o]));
  const t0 = now.getTime();
  const groups = new Map();
  const hours = new Map();
  for (const p of posts) {
    const t = Date.parse(p.createdAt);
    if (!(t <= t0 && t0 - t <= 48 * HOUR)) continue;
    const isNews = p.source === 'news' || String(p.did).startsWith('news:');
    const v = isNews ? null : byDid.get(p.did);
    const o = isNews ? byDomain.get(p.handle) : null;
    const channel = isNews ? (p.telegram || o?.telegram ? 'Telegram' : 'RSS') : 'Bluesky';
    const row = {
      window: t0 - t <= 24 * HOUR ? 'Last 24 hours' : '24 to 48 hours ago',
      channel,
      source: (o?.name || v?.name || p.displayName || p.handle),
      account: p.handle,
      affiliation: o?.affiliation || o?.name || v?.affiliation || v?.name || p.handle,
      role: isNews ? (o?.tier && o.tier !== 1 ? ROLE[o.tier] || 'Other' : 'Outlet') : ROLE[v?.tier] || 'Other',
      state_affiliated: (o || v)?.stateAffiliated ? 'Yes' : 'No',
      coverage: COVERAGE[p.node] || 'General',
      based_in: (o || v)?.region || '',
    };
    const key = [row.window, channel, row.account, row.coverage].join('|');
    const g = groups.get(key) || { ...row, items: 0, bluesky_likes_reposts: isNews ? '' : 0 };
    g.items++;
    if (!isNews) g.bluesky_likes_reposts += (p.counts?.likes || 0) + (p.counts?.reposts || 0);
    groups.set(key, g);
    const hour = `${new Date(Math.floor(t / HOUR) * HOUR).toISOString().slice(0, 13)}:00Z`;
    const hk = `${hour}|${channel}`;
    hours.set(hk, (hours.get(hk) || 0) + 1);
  }
  const items = [...groups.values()].sort((a, b) => a.window.localeCompare(b.window) || b.items - a.items || a.account.localeCompare(b.account));
  const hourly = [...hours].map(([k, n]) => { const [hour, channel] = k.split('|'); return { hour, channel, items: n }; })
    .sort((a, b) => a.hour.localeCompare(b.hour) || a.channel.localeCompare(b.channel));

  const kept24 = new Map();
  for (const r of items) if (r.channel !== 'Bluesky' && r.window === 'Last 24 hours') kept24.set(r.account, (kept24.get(r.account) || 0) + r.items);
  const feeds = new Map();
  for (const s of sources) {
    if (s.kind !== 'rss' && s.kind !== 'telegram') continue;
    const f = feeds.get(s.outlet) || { feeds: 0, ok: 0, items: 0, errors: new Set() };
    f.feeds++;
    if (s.ok) f.ok++;
    f.items += s.items || 0;
    if (s.error) f.errors.add(String(s.error).slice(0, 60));
    feeds.set(s.outlet, f);
  }
  const outletRows = outlets.map((o) => {
    const f = feeds.get(o.domain);
    const status = !f ? (o.telegram ? 'Not read' : 'No RSS feed') : f.ok === f.feeds ? 'Working' : f.ok === 0 ? 'Failing' : 'Partly failing';
    return {
      outlet: o.name,
      domain: o.domain,
      kind: o.telegram ? 'Telegram' : 'RSS',
      state_affiliated: o.stateAffiliated ? 'Yes' : 'No',
      based_in: o.region || '',
      feeds: f?.feeds || 0,
      feeds_working: f?.ok || 0,
      status,
      articles_in_feed: f?.items || 0,
      articles_kept_24h: kept24.get(o.domain) || 0,
      problem: f ? [...f.errors].sort().join('; ') : o.telegram ? 'Channel not read in the last run' : 'No RSS feed listed',
    };
  });
  return { items, hourly, outlets: outletRows };
}

/**
 * Every configured source, whether or not it supplied anything: RSS outlets,
 * Telegram channels and Bluesky voices, with a link and a status, so the
 * source list can be checked and edited.
 * @param {object} o
 * @param {Array} o.voices    every voice from voices.example.json (makeVoice)
 * @param {Array} o.missing   handles Bluesky says don't exist
 * @param {Array} o.outlets   news.json's outlets (RSS outlets and Telegram channels)
 * @param {Array} o.sources   news.json's per-feed report
 * @param {Array} o.items     resourceStats(...).items
 */
export function sourceList({ voices, missing = [], outlets, sources = [], items }) {
  const count = new Map();
  for (const r of items) {
    const k = `${r.channel}|${r.account}`;
    const c = count.get(k) || { d1: 0, d2: 0 };
    if (r.window === 'Last 24 hours') c.d1 += r.items;
    c.d2 += r.items;
    count.set(k, c);
  }
  const report = new Map();
  for (const s of sources) {
    if (s.kind !== 'rss' && s.kind !== 'telegram') continue;
    const list = report.get(s.outlet) || [];
    list.push(s);
    report.set(s.outlet, list);
  }
  const gone = new Set(missing.map((h) => String(h).toLowerCase()));
  const rows = [];
  for (const o of outlets) {
    const tg = Boolean(o.telegram);
    const channel = tg ? 'Telegram' : 'RSS';
    const rep = report.get(o.domain) || [];
    const ok = rep.filter((x) => x.ok).length;
    const c = count.get(`${channel}|${o.domain}`) || { d1: 0, d2: 0 };
    const status = !rep.length ? (tg ? 'Not read' : 'No RSS feed') : ok === rep.length ? 'Working' : ok === 0 ? 'Failing' : 'Partly failing';
    rows.push({
      type: tg ? 'Telegram channel' : 'RSS outlet',
      name: o.name,
      affiliation: o.affiliation || o.name,
      handle: o.domain,
      link: tg ? `https://t.me/s/${o.domain.slice('t.me/'.length)}` : `https://${o.domain}`,
      role: tg ? ROLE[o.tier] || 'Outlet' : 'Outlet',
      based_in: o.region || '',
      state_affiliated: o.stateAffiliated ? 'Yes' : 'No',
      state_country: stateCountry(o) || '',
      status,
      items_24h: c.d1,
      items_48h: c.d2,
      detail: tg
        ? [...new Set(rep.map((x) => x.error).filter(Boolean))].join('; ')
        : rep.length ? rep.map((x) => (x.ok ? x.url : `${x.url} (${x.error || 'failed'})`)).join(' ; ') : 'No RSS feed listed',
    });
  }
  for (const v of voices) {
    const c = count.get(`Bluesky|${v.handle}`) || { d1: 0, d2: 0 };
    const status = gone.has(v.handle) ? 'Account not found' : c.d2 ? 'Posting' : 'No matching posts in 48 hours';
    rows.push({
      type: 'Bluesky account',
      name: v.name,
      affiliation: v.affiliation,
      handle: v.handle,
      link: `https://bsky.app/profile/${v.handle}`,
      role: ROLE[v.tier] || 'Other',
      based_in: v.region || '',
      state_affiliated: v.stateAffiliated ? 'Yes' : 'No',
      state_country: v.country || '',
      status,
      items_24h: c.d1,
      items_48h: c.d2,
      detail: v.handle.endsWith('.brid.gy') ? 'Unofficial bridge of the website' : v.domainVerified ? 'Domain handle' : '',
    });
  }
  const order = { 'RSS outlet': 0, 'Telegram channel': 1, 'Bluesky account': 2 };
  return rows.sort((a, b) => order[a.type] - order[b.type] || a.name.localeCompare(b.name));
}

export function toCsv(rows, columns = Object.keys(rows[0] || {})) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

export const COLUMNS = {
  items: ['window', 'channel', 'source', 'account', 'affiliation', 'role', 'state_affiliated', 'coverage', 'based_in', 'items', 'bluesky_likes_reposts'],
  hourly: ['hour', 'channel', 'items'],
  sources: ['type', 'name', 'affiliation', 'handle', 'link', 'role', 'based_in', 'state_affiliated', 'state_country', 'status', 'items_24h', 'items_48h', 'detail'],
  outlets: ['outlet', 'domain', 'kind', 'state_affiliated', 'based_in', 'feeds', 'feeds_working', 'status', 'articles_in_feed', 'articles_kept_24h', 'problem'],
};
export { FEED_STATUS };

function args(argv) {
  const o = {
    news: 'https://inthelooplive.com/news.json',
    voices: join(root, 'voices.example.json'),
    hierarchy: join(root, 'topics.hierarchy.example.json'),
    node: 'geopolitics',
    out: 'stats',
  };
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) o[argv[i].slice(2)] = argv[++i];
  return o;
}

async function readJson(where) {
  if (/^https?:\/\//.test(where)) {
    const res = await fetch(`${where}?t=${Date.now()}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`${where}: HTTP ${res.status}`);
    return res.json();
  }
  return JSON.parse(readFileSync(where, 'utf8'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = args(process.argv.slice(2));
  const hierarchy = makeHierarchy(await readJson(o.hierarchy));
  const voicesSpec = await readJson(o.voices);
  const voices = (Array.isArray(voicesSpec) ? voicesSpec : voicesSpec.voices).map(makeVoice);
  const newsDoc = await readJson(o.news);
  const now = new Date();
  const brief = await buildBrief({
    client: new BskyClient(),
    hierarchy,
    node: o.node,
    voices,
    now,
    since: new Date(now - 48 * HOUR),
    search: false,
    news: newsPosts(newsDoc),
    perVoice: 150,
  });
  const stats = resourceStats({ posts: brief.posts, voices: brief.voices, outlets: newsDoc.outlets || [], sources: newsDoc.sources || [], now });
  mkdirSync(o.out, { recursive: true });
  stats.sources = sourceList({ voices, missing: brief.missingVoices || [], outlets: newsDoc.outlets || [], sources: newsDoc.sources || [], items: stats.items });
  for (const name of ['items', 'hourly', 'outlets', 'sources']) writeFileSync(join(o.out, `${name}.csv`), toCsv(stats[name], COLUMNS[name]));
  const meta = {
    generatedAt: now.toISOString(),
    newsGeneratedAt: newsDoc.generatedAt || null,
    node: o.node,
    voices: brief.voices.length,
    missingVoices: brief.missingVoices?.length || 0,
    errors: brief.errors,
    items24h: stats.items.filter((r) => r.window === 'Last 24 hours').reduce((a, r) => a + r.items, 0),
  };
  writeFileSync(join(o.out, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(`Wrote ${o.out}/: ${meta.items24h} items in the last 24 hours, ${brief.errors.length} errors.`);
}
