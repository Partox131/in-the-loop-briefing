#!/usr/bin/env node
// The day's top stories for social posts, as one small JSON file (social.json).
// Runs once a day in the public site's "Resource stats" workflow (deploy/stats.yml),
// which can reach Bluesky and the site; it is pushed to the "stats" branch next to
// the dashboard's CSV files. A daily Claude routine reads it and writes the day's
// post drafts for Amir to review (social media workstream, 26 Nov 2026). No AI here:
// this only picks and describes stories with the same code the live map uses.
//
//   node scripts/social-brief.js [--news <url or file of news.json>]
//     [--voices voices.example.json] [--hierarchy topics.hierarchy.example.json] [--out stats]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BskyClient } from '../src/bsky.js?v=355b4e7eab';
import { buildBrief } from '../src/brief.js?v=355b4e7eab';
import { makeHierarchy } from '../src/hierarchy.js?v=355b4e7eab';
import { newsPosts } from '../src/news.js?v=355b4e7eab';
import { makeVoice } from '../src/voices.js?v=355b4e7eab';
import { alertNews, regionSummary, regionsOf } from '../src/live.js?v=355b4e7eab';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOUR = 3_600_000;
export const SITE = 'https://inthelooplive.com/';

/** The areas a post can be about: each geopolitics region, then each politics segment. */
export function areasOf(h) {
  const geo = regionsOf(h, 'geopolitics').map((r) => (typeof r === 'string' ? r : r.id)).filter(Boolean)
    .map((id) => ({ id, segment: 'Geopolitics', link: `${SITE}?view=${id}` }));
  const segs = [['us-politics', 'us'], ['ca-politics', 'ca']].filter(([id]) => h.nodes.has(id))
    .map(([id, key]) => ({ id, segment: h.get(id).label, link: `${SITE}?segment=${key}` }));
  return [...geo, ...segs].map((a) => ({ ...a, label: h.get(a.id).label }));
}

const STATUS_WORD = { corroborated: 'confirmed by several outlets', official: 'confirmed officially', disputed: 'disputed', reported: 'reported, not yet confirmed', claimed: "one side's claim" };

/** Shape one area's summary for the drafts: plain fields, outlet names, no post bodies. */
export function socialArea(area, sum, alerts) {
  const pick = (b) => ({ headline: b.headline, url: b.url || null, outlets: b.outlets, names: b.names, place: b.topicLabel, firstSeen: b.firstSeen });
  const names = (s) => (s.sources || []).map((x) => (typeof x === 'string' ? x : x.name || x.affiliation || x.handle)).filter(Boolean);
  return {
    ...area,
    stories: sum.stories,
    posts: sum.posts,
    confirmed: sum.confirmed,
    disputed: sum.disputed,
    newStories: sum.newStories,
    busiestPlace: sum.busiestPlace?.label || null,
    top: sum.top.map((s) => ({
      headline: s.headline,
      url: s.url || null,
      status: s.status,
      statusWords: STATUS_WORD[s.status] || s.status,
      outlets: names(s).slice(0, 6),
      outletCount: names(s).length,
      place: s.place?.label || null,
      firstSeen: s.firstSeen,
      lastSeen: s.lastSeen,
    })),
    // breaking: a new event in its first hour; hot: widely covered now (src/live.js alertNews)
    breaking: alerts.filter((b) => (b.kind || 'breaking') === 'breaking').slice(0, 3).map(pick),
    hot: alerts.filter((b) => b.kind === 'hot').slice(0, 3).map(pick),
  };
}

function args(argv) {
  const o = { news: `${SITE}news.json`, voices: join(root, 'voices.example.json'), hierarchy: join(root, 'topics.hierarchy.example.json'), out: 'stats' };
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
  const spec = await readJson(o.voices);
  const voices = (Array.isArray(spec) ? spec : spec.voices).map(makeVoice);
  const newsDoc = await readJson(o.news);
  const now = new Date();
  const brief = await buildBrief({ client: new BskyClient(), hierarchy, node: 'politics', voices, now, since: new Date(now - 24 * HOUR), search: false, news: newsPosts(newsDoc), perVoice: 150 });
  const areas = areasOf(hierarchy).map((a) => socialArea(a,
    regionSummary({ posts: brief.posts, hierarchy, node: a.id, now, topN: 8 }),
    alertNews({ posts: brief.posts, hierarchy, node: a.id, now })));
  const doc = { generatedAt: now.toISOString(), site: SITE, hours: 24, areas, errors: brief.errors.length };
  mkdirSync(o.out, { recursive: true });
  writeFileSync(join(o.out, 'social.json'), JSON.stringify(doc, null, 2) + '\n');
  console.log(`Wrote ${o.out}/social.json: ${areas.map((a) => `${a.label} ${a.stories}`).join(', ')}.`);
}
