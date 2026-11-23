// Browser entry point for the static (GitHub Pages) build of the briefing
// page. The same pipeline as `serve` runs here, in the visitor's browser,
// reading Bluesky's public AppView directly: no server, no login, read-only.
//
// Search is off here: Bluesky's public search often refuses anonymous
// callers, so the static page follows the voice list (getAuthorFeed) only.

import { BskyClient } from './bsky.js?v=453846a99e';
import { buildBrief } from './brief.js?v=453846a99e';
import { DEMO_VOICES, demoFetch } from './demo.js?v=453846a99e';
import { project } from './geo.js?v=453846a99e';
import { makeHierarchy } from './hierarchy.js?v=453846a99e';
import { subscribePosts } from './jetstream.js?v=453846a99e';
import { makeLive } from './live.js?v=453846a99e';
import { newsPosts } from './news.js?v=453846a99e';
import { makeVoice } from './voices.js?v=453846a99e';
import { briefView } from './view.js?v=453846a99e';

const SINCE_HOURS = { '6h': 6, '12h': 12, '24h': 24, '48h': 48, '7d': 168 };
const CACHE_MS = 120_000;

async function getJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.json();
}

/**
 * news.json, written every 15 minutes by the site's scheduled collector
 * (scripts/collect-news.js). Missing or broken: carry on with Bluesky only.
 */
export async function loadNews(base = '.') {
  try {
    const res = await fetch(`${base}/news.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    return newsPosts(await res.json());
  } catch {
    return null;
  }
}

export async function init({ base = '.', defaultNode = 'iran-war' } = {}) {
  const [hierarchySpec, voicesSpec] = await Promise.all([
    getJson(`${base}/topics.hierarchy.example.json`),
    getJson(`${base}/voices.example.json`),
  ]);
  const hierarchy = makeHierarchy(hierarchySpec);
  const voices = (Array.isArray(voicesSpec) ? voicesSpec : voicesSpec.voices).map(makeVoice);
  const live = new BskyClient();
  const demo = new BskyClient({ fetchImpl: demoFetch() });
  const cache = new Map();

  return async ({ node, since = '24h', demo: useDemo = false }) => {
    const id = node && hierarchy.nodes.has(node) ? node : defaultNode;
    const hours = SINCE_HOURS[since] ?? 24;
    const key = `${id}|${hours}|${useDemo}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const now = new Date();
    const brief = await buildBrief({
      news: useDemo ? undefined : (await loadNews(base)) || undefined,
      client: useDemo ? demo : live,
      hierarchy,
      node: id,
      voices: useDemo ? DEMO_VOICES : voices,
      now,
      since: new Date(now - hours * 3_600_000),
      search: false,
    });
    const value = { ...briefView(brief, hierarchy, { now }), demo: useDemo };
    cache.set(key, { at: Date.now(), value });
    return value;
  };
}

/**
 * The live map page (public/live.html). Loads the last 24 hours once, then
 * follows the voices' new posts through Jetstream (skipped in demo mode).
 */
export async function initLive({ base = '.', node = 'geopolitics', demo = false } = {}) {
  const [hierarchySpec, voicesSpec, maps] = await Promise.all([
    getJson(`${base}/topics.hierarchy.example.json`),
    getJson(`${base}/voices.example.json`),
    getJson(`${base}/maps.json`),
  ]);
  const hierarchy = makeHierarchy(hierarchySpec);
  const voices = (Array.isArray(voicesSpec) ? voicesSpec : voicesSpec.voices).map(makeVoice);
  const live = makeLive({
    client: demo ? new BskyClient({ fetchImpl: demoFetch() }) : new BskyClient(),
    hierarchy,
    voices: demo ? DEMO_VOICES : voices,
    node: hierarchy.nodes.has(node) ? node : 'geopolitics',
    loadNews: demo ? async () => null : () => loadNews(base),
  });
  return {
    live,
    maps: maps.views,
    project,
    /** Start following new posts; returns { close() }, or null in demo mode. */
    follow: ({ onPost, onStatus }) => (demo ? null : subscribePosts({ dids: live.dids(), onPost, onStatus })),
  };
}
