#!/usr/bin/env node
// Rewrite the region and segment pages (/middle-east/, /us-politics/, …) and
// the sitemap with the last 24 hours, from the server's snapshot.json. Run by
// the public site's Pages workflow every 15 minutes (deploy/pages.yml) from
// the site folder, after the news collector:
//
//   node tools/make-pages.js [--dir .] [--snapshot <url>]
//
// If the snapshot is missing or stale, it leaves the pages as built (the
// backgrounder and topics, no live summary) and exits cleanly: it never calls
// Bluesky directly. Pages and plan: scripts/region-pages.js, docs/research/seo.md.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeHierarchy } from '../src/hierarchy.js?v=bf4288f53c';
import { makeLive } from '../src/live.js?v=bf4288f53c';
import { newsPosts } from '../src/news.js?v=bf4288f53c';
import { SnapshotClient } from '../src/snapshot.js?v=bf4288f53c';
import { makeVoice } from '../src/voices.js?v=bf4288f53c';
import { PAGES, renderPage, sitemap } from './region-pages.js';

const SNAPSHOT_URL = 'https://api.inthelooplive.com/snapshot.json';

// Stands in for Bluesky behind the snapshot: this job reads the snapshot only.
const noDirect = {
  profileCache: new Map(),
  authorFeed: async () => { throw new Error('snapshot only'); },
  query: async () => { throw new Error('snapshot only'); },
  searchPosts: async () => { throw new Error('snapshot only'); },
  profiles: async () => [],
};

/**
 * Render every region and segment page with live data. Returns
 * { [path]: html }, or null when the data client has nothing usable.
 */
export async function livePages({ client, loadNews, hierarchy: h, voices, backgrounders, now = new Date(), analytics = '' }) {
  const out = {};
  const bySegment = new Map();
  for (const page of PAGES) {
    if (!bySegment.has(page.segment)) {
      const live = makeLive({ client, hierarchy: h, voices, node: page.segment, loadNews });
      await live.load(now);
      bySegment.set(page.segment, live);
    }
    const live = bySegment.get(page.segment);
    const v = live.view({ now, region: page.node === page.segment ? 'world' : page.node });
    out[`${page.slug}/index.html`] = renderPage({
      page,
      h,
      bg: backgrounders?.regions?.[page.node] || null,
      reviewed: backgrounders?.reviewed,
      summary: v.summary,
      now,
      analytics,
    });
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = { dir: '.', snapshot: SNAPSHOT_URL };
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
  const dir = resolve(opt.dir);
  const json = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const hierarchy = makeHierarchy(json('topics.hierarchy.example.json'));
  const vs = json('voices.example.json');
  const voices = (Array.isArray(vs) ? vs : vs.voices).map(makeVoice);
  const backgrounders = json('backgrounders.json');
  // The pages load analytics.js like the others; the build stamped its version into index.html.
  const analytics = (readFileSync(join(dir, 'index.html'), 'utf8').match(/<script src="analytics\.js\?v=[0-9a-f]+"><\/script>/)?.[0] || '').replace('src="', 'src="/') + '\n';
  const client = new SnapshotClient({ url: opt.snapshot, fallback: noDirect, timeoutMs: 20_000 });
  const now = new Date();
  if (!(await client.usable(new Date(now - 24 * 3_600_000)))) {
    console.log('Snapshot missing or stale: pages left as built.');
    return;
  }
  const loadNews = async () => {
    const n = await client.news();
    return n ? newsPosts(n) : null;
  };
  const pages = await livePages({ client, loadNews, hierarchy, voices, backgrounders, now, analytics });
  for (const [path, html] of Object.entries(pages)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), html);
  }
  writeFileSync(join(dir, 'sitemap.xml'), sitemap(now));
  console.log(`Wrote ${Object.keys(pages).length} pages and the sitemap.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // Never fail the deploy over these pages: the built ones stay.
    console.error(`make-pages: ${err.message}`);
  });
}
