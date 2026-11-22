// The live map: how much the tracked voices are posting about each place
// under a topic (Gaza, Lebanon, the Strait of Hormuz…) right now, compared
// with their usual pace, plus the newest posts as they arrive.
//
// It reuses the briefing pipeline (brief.js) for the first load, then keeps
// up through Jetstream: a WebSocket of new posts filtered to the voices'
// accounts, which works straight from the browser. Read-only, no login.

import { buildBrief } from './brief.js?v=50ba1b5a55';
import { rankPosts } from './rank.js?v=50ba1b5a55';
import { buildStorylines } from './storylines.js?v=50ba1b5a55';
import { byDid } from './voices.js?v=50ba1b5a55';

const HOUR = 3_600_000;

/** The place node a topic id rolls up to: itself, else its nearest ancestor with a place. */
export function placeOf(h, topicId, scope) {
  const queue = [topicId];
  const seen = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id) || !scope.has(id)) continue;
    seen.add(id);
    if (h.get(id).place) return id;
    queue.push(...h.get(id).parents);
  }
  return null;
}

/** Mostly confirmed, mostly single-source, or contested: by share of posts. */
export function overallStatus(stories) {
  const total = stories.reduce((s, x) => s + x.posts.length, 0);
  if (!total) return 'quiet';
  const share = (...st) => stories.filter((x) => st.includes(x.status)).reduce((s, x) => s + x.posts.length, 0) / total;
  if (share('disputed') >= 0.3) return 'disputed';
  if (share('corroborated', 'official') >= 0.5) return 'corroborated';
  return 'reported';
}

function postLine(p, h) {
  return {
    uri: p.uri,
    url: p.url,
    text: p.text,
    at: p.createdAt,
    who: p.voice?.name || p.displayName || p.handle || 'unknown',
    tier: p.voice?.tier,
    stateAffiliated: Boolean(p.voice?.stateAffiliated),
    topicId: p.topicId,
    topicLabel: h.get(p.topicId).label,
    live: p.source === 'live',
  };
}

/**
 * @param {object} o
 * @param {Array} o.posts        on-topic posts (each with topicId and voice)
 * @param {ReturnType<import('./hierarchy.js').makeHierarchy>} o.hierarchy
 * @param {string} o.node        e.g. "middle-east"
 * @param {Date} o.now
 * @param {number} [o.windowHours]   the "right now" window (default 1)
 * @param {number} [o.lookbackHours] what "usual" is measured over (default 24)
 */
export function liveView({ posts, hierarchy: h, node, now, windowHours = 1, lookbackHours = 24 }) {
  const scope = new Set([node, ...h.descendants(node)]);
  const t = now.getTime();
  const winStart = t - windowHours * HOUR;
  const lookStart = t - lookbackHours * HOUR;
  const byPlace = new Map();
  for (const p of posts) {
    const at = Date.parse(p.createdAt);
    if (!(at >= lookStart && at <= t + 5 * 60_000)) continue;
    const place = placeOf(h, p.topicId, scope) || 'other';
    if (!byPlace.has(place)) byPlace.set(place, []);
    byPlace.get(place).push(p);
  }

  const places = [...scope].filter((id) => h.get(id).place);
  const areas = places.map((id) => {
    const all = byPlace.get(id) || [];
    const recent = all.filter((p) => Date.parse(p.createdAt) >= winStart);
    const earlier = all.length - recent.length;
    const perHour = recent.length / windowHours;
    const usual = earlier / Math.max(lookbackHours - windowHours, 1);
    const stories = buildStorylines(recent);
    const n = h.get(id);
    return {
      id,
      label: n.label,
      place: n.place,
      count: recent.length,
      perHour: Math.round(perHour * 10) / 10,
      usualPerHour: Math.round(usual * 10) / 10,
      // null when there's no history to compare with
      pace: usual > 0 ? Math.round((perHour / usual) * 10) / 10 : null,
      status: overallStatus(stories),
      voices: new Set(recent.filter((p) => p.voice).map((p) => p.voice.affiliation)).size,
      latest: recent.length ? recent.map((p) => p.createdAt).sort().at(-1) : null,
      storylines: stories.slice(0, 3).map((s) => ({
        status: s.status,
        text: s.lead.text,
        url: s.lead.url,
        by: s.lead.voice?.name || s.lead.handle,
        sources: s.sources,
        posts: s.posts.length,
        firstSeen: s.firstSeen,
      })),
    };
  });

  const feed = posts
    .filter((p) => scope.has(p.topicId) && Date.parse(p.createdAt) >= lookStart)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 30)
    .map((p) => ({ ...postLine(p, h), area: placeOf(h, p.topicId, scope) }));

  return {
    generatedAt: now.toISOString(),
    node: { id: node, label: h.get(node).label },
    windowHours,
    areas: areas.sort((a, b) => b.count - a.count),
    other: (byPlace.get('other') || []).filter((p) => Date.parse(p.createdAt) >= winStart).length,
    feed,
  };
}

/**
 * Keeps the posts for a topic and takes new ones as they arrive.
 * @param {object} o
 * @param {import('./bsky.js').BskyClient} o.client
 * @param {ReturnType<import('./hierarchy.js').makeHierarchy>} o.hierarchy
 * @param {import('./voices.js').Voice[]} o.voices
 * @param {string} o.node
 */
export function makeLive({ client, hierarchy: h, voices, node, lookbackHours = 24 }) {
  const scope = new Set([node, ...h.descendants(node)]);
  let posts = [];
  let voiceIndex = new Map();
  let meta = { voices: 0, missingVoices: [], errors: [] };

  return {
    /** Full reload from Bluesky (author feeds of every voice). */
    async load(now = new Date()) {
      const brief = await buildBrief({
        client,
        hierarchy: h,
        node,
        voices,
        now,
        since: new Date(now - lookbackHours * HOUR),
        search: false,
        perVoice: 100,
      });
      voiceIndex = byDid(brief.voices);
      const live = posts.filter((p) => p.source === 'live' && !brief.posts.some((q) => q.uri === p.uri));
      posts = [...brief.posts, ...live];
      meta = { voices: brief.voices.length, missingVoices: brief.missingVoices, errors: brief.errors };
    },
    /** DIDs to ask Jetstream for. */
    dids: () => [...voiceIndex.keys()],
    /** A post from Jetstream. Returns true if it's on topic and was added. */
    add(post) {
      const voice = voiceIndex.get(post.did);
      if (!voice || posts.some((p) => p.uri === post.uri)) return false;
      const hits = h.classify(post).filter((m) => scope.has(m.id));
      if (!hits.length) return false;
      const [ranked] = rankPosts([{ ...post, handle: post.handle || voice.handle, displayName: post.displayName || voice.name }], {
        voices: voiceIndex,
      });
      posts.push({ ...ranked, topicId: hits[0].id, matchedTerms: hits.flatMap((m) => m.terms) });
      return true;
    },
    view({ now = new Date(), windowHours = 1 } = {}) {
      return { ...liveView({ posts, hierarchy: h, node, now, windowHours, lookbackHours }), ...meta };
    },
  };
}
