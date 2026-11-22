// Browser entry point for the static (GitHub Pages) build of the briefing
// page. The same pipeline as `serve` runs here, in the visitor's browser,
// reading Bluesky's public AppView directly: no server, no login, read-only.
//
// Search is off here: Bluesky's public search often refuses anonymous
// callers, so the static page follows the voice list (getAuthorFeed) only.

import { BskyClient } from './bsky.js?v=708ab11dd4';
import { buildBrief } from './brief.js?v=708ab11dd4';
import { DEMO_VOICES, demoFetch } from './demo.js?v=708ab11dd4';
import { makeHierarchy } from './hierarchy.js?v=708ab11dd4';
import { makeVoice } from './voices.js?v=708ab11dd4';
import { briefView } from './view.js?v=708ab11dd4';

const SINCE_HOURS = { '6h': 6, '12h': 12, '24h': 24, '48h': 48, '7d': 168 };
const CACHE_MS = 120_000;

async function getJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.json();
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
