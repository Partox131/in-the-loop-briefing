// Browser entry point for the static (GitHub Pages) build of the briefing
// page. The same pipeline as `serve` runs here, in the visitor's browser,
// reading Bluesky's public AppView directly: no server, no login, read-only.
//
// Search is off here: Bluesky's public search often refuses anonymous
// callers, so the static page follows the voice list (getAuthorFeed) only.
//
// Since 23 Nov 2026 the voices' posts and the news come from our server's
// snapshot.json (one request) when it is fresh, with this browser-only mode
// as the fallback (src/snapshot.js). Add ?direct=1 to the URL to skip the
// server, or ?snapshot=<url> to try another one.

import { BskyClient } from './bsky.js?v=bc7b86b967';
import { buildBrief } from './brief.js?v=bc7b86b967';
import { DEMO_VOICES, demoFetch } from './demo.js?v=bc7b86b967';
import { project } from './geo.js?v=bc7b86b967';
import { makeHierarchy } from './hierarchy.js?v=bc7b86b967';
import { subscribePosts } from './jetstream.js?v=bc7b86b967';
import { makeLive } from './live.js?v=bc7b86b967';
import { newsPosts } from './news.js?v=bc7b86b967';
import { SnapshotClient } from './snapshot.js?v=bc7b86b967';
import { makeVoice } from './voices.js?v=bc7b86b967';
import { briefView } from './view.js?v=bc7b86b967';

const SINCE_HOURS = { '6h': 6, '12h': 12, '24h': 24, '48h': 48, '7d': 168 };
const CACHE_MS = 120_000;
export const SNAPSHOT_URL = 'https://api.inthelooplive.com/snapshot.json';

/** The server's snapshot in front of Bluesky, unless the URL says ?direct=1. */
export function makeClient({ search = globalThis.location?.search || '', url = SNAPSHOT_URL } = {}) {  const direct = new BskyClient();
  const q = new URLSearchParams(search);
  if (q.has('direct')) return direct;
  return new SnapshotClient({ url: q.get('snapshot') || url, fallback: direct });
}

export const STORIES_URL = SNAPSHOT_URL.replace(/snapshot\.json$/, 'stories.json');
let storiesCache = null;
/**
 * The server's stories.json (storylines kept over days with their timeline,
 * and each source's track record, scripts/stories.js), or null. Fetched at
 * most every 2 minutes; the page works the same without it.
 */
export async function loadStories({ search = globalThis.location?.search || '', fetchImpl = globalThis.fetch } = {}) {
  const q = new URLSearchParams(search);
  if (q.has('direct') && !q.has('stories')) return null;
  if (storiesCache && Date.now() - storiesCache.at < CACHE_MS) return storiesCache.value;
  const url = q.get('stories') || (q.get('snapshot') ? q.get('snapshot').replace(/snapshot\.json(\?.*)?$/, 'stories.json') : STORIES_URL);
  let value = null;
  try {
    const res = await fetchImpl(url, { cache: 'no-cache', signal: AbortSignal.timeout(6_000) });
    if (res.ok) value = await res.json();
  } catch {
    value = null;
  }
  if (value?.version !== 1 || !Array.isArray(value.storylines)) value = storiesCache?.value || null;
  storiesCache = { at: Date.now(), value };
  return value;
}

/**
 * Give each story on the page its stored history: the storyline that holds
 * any of its posts. Adds `history` (id, first seen, timeline) to the story and
 * `records` (track record by source) to the view.
 */
export function withHistory(view, doc) {
  if (!doc) return view;
  const byItem = new Map();
  for (const st of doc.storylines) for (const uri of st.items || []) byItem.set(uri, st);
  const stories = view.stories.map((s) => {
    const st = (s.uris || []).map((u) => byItem.get(u)).find(Boolean);
    return st ? { ...s, history: { id: st.id, firstSeen: st.firstSeen, lastSeen: st.lastSeen, status: st.status, events: st.events || [] } } : s;
  });
  return { ...view, stories, records: doc.records || {}, storiesAt: doc.generatedAt };
}

async function getJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.json();
}

/**
 * news.json, written every 15 minutes by the site's scheduled collector
 * (scripts/collect-news.js). Missing or broken: carry on with Bluesky only.
 */
export async function loadNews(base = '.', client = null) {
  try {
    const fromServer = await client?.news?.();
    if (fromServer) return newsPosts(fromServer);
  } catch {
    // fall through to the site's own news.json
  }
  try {
    const res = await fetch(`${base}/news.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    return newsPosts(await res.json());
  } catch {
    return null;
  }
}

export async function init({ base = '.', defaultNode = 'iran-war', search } = {}) {
  const [hierarchySpec, voicesSpec] = await Promise.all([
    getJson(`${base}/topics.hierarchy.example.json`),
    getJson(`${base}/voices.example.json`),
  ]);
  const hierarchy = makeHierarchy(hierarchySpec);
  const voices = (Array.isArray(voicesSpec) ? voicesSpec : voicesSpec.voices).map(makeVoice);
  const live = makeClient({ search });
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
      news: useDemo ? undefined : (await loadNews(base, live)) || undefined,
      client: useDemo ? demo : live,
      hierarchy,
      node: id,
      voices: useDemo ? DEMO_VOICES : voices,
      now,
      since: new Date(now - hours * 3_600_000),
      search: false,
    });
    const view = { ...briefView(brief, hierarchy, { now }), demo: useDemo, source: useDemo ? 'demo' : live.mode || 'direct' };
    // ?stories=<url> tries another stories.json (also in demo mode, for checking the page)
    const value = useDemo && !new URLSearchParams(search ?? globalThis.location?.search ?? '').has('stories') ? view : withHistory(view, await loadStories({ search }));
    cache.set(key, { at: Date.now(), value });
    return value;
  };
}

// The live map switches between its segments (Geopolitics, US and Canadian
// politics) without reloading the page, so each segment's map shares one copy
// of the config files, maps and data client: the snapshot is fetched once
// (the client caches it) whichever segment asks first.
const sharedLive = new Map();
function liveBase(base, demo, search) {
  const key = `${base}|${demo}|${search ?? ''}`;
  if (!sharedLive.has(key)) {
    const ready = Promise.all([
      getJson(`${base}/topics.hierarchy.example.json`),
      getJson(`${base}/voices.example.json`),
      getJson(`${base}/maps.json`),
    ]).then(([hierarchySpec, voicesSpec, maps]) => ({
      hierarchy: makeHierarchy(hierarchySpec),
      voices: (Array.isArray(voicesSpec) ? voicesSpec : voicesSpec.voices).map(makeVoice),
      maps,
      client: demo ? new BskyClient({ fetchImpl: demoFetch() }) : makeClient({ search }),
    }));
    ready.catch(() => sharedLive.delete(key));
    sharedLive.set(key, ready);
  }
  return sharedLive.get(key);
}

/**
 * The live map page (public/live.html). Loads the last 24 hours once, then
 * follows the voices' new posts through Jetstream (skipped in demo mode).
 * Called once per segment; the calls share their config files and client.
 */
export async function initLive({ base = '.', node = 'geopolitics', demo = false, search } = {}) {
  const { hierarchy, voices, maps, client } = await liveBase(base, demo, search);
  const live = makeLive({
    client,
    hierarchy,
    voices: demo ? DEMO_VOICES : voices,
    node: hierarchy.nodes.has(node) ? node : 'geopolitics',
    loadNews: demo ? async () => null : () => loadNews(base, client),
  });
  return {
    live,
    maps: maps.views,
    project,
    /** Start following new posts; returns { close() }, or null in demo mode. */
    follow: ({ onPost, onStatus }) => (demo ? null : subscribePosts({ dids: live.dids(), onPost, onStatus })),
  };
}
