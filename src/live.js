// The live map: how much the tracked voices are posting about each place
// in a region (Gaza, Kyiv, the Taiwan Strait…) right now, compared
// with their usual pace, plus the newest posts as they arrive.
//
// It reuses the briefing pipeline (brief.js) for the first load, then keeps
// up through Jetstream: a WebSocket of new posts filtered to the voices'
// accounts, which works straight from the browser. Read-only, no login.

import { buildBrief } from './brief.js?v=453846a99e';
import { rankPosts } from './rank.js?v=453846a99e';
import { buildStorylines } from './storylines.js?v=453846a99e';
import { byDid } from './voices.js?v=453846a99e';

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
    news: p.source === 'news',
    telegram: Boolean(p.telegram),
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
  // The node itself may have a place (for the world map); here only what's under it counts.
  const under = new Set(h.descendants(node));
  const t = now.getTime();
  const winStart = t - windowHours * HOUR;
  const lookStart = t - lookbackHours * HOUR;
  const byPlace = new Map();
  for (const p of posts) {
    const at = Date.parse(p.createdAt);
    if (!(at >= lookStart && at <= t + 5 * 60_000)) continue;
    if (!scope.has(p.topicId)) continue;
    const place = placeOf(h, p.topicId, under) || 'other';
    if (!byPlace.has(place)) byPlace.set(place, []);
    byPlace.get(place).push(p);
  }

  const places = [...under].filter((id) => h.get(id).place);
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
        news: s.lead.source === 'news',
        telegram: Boolean(s.lead.telegram),
        articles: s.posts.filter((p) => p.source === 'news').length,
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
    .map((p) => ({ ...postLine(p, h), area: placeOf(h, p.topicId, under) }));

  return {
    generatedAt: now.toISOString(),
    node: { id: node, label: h.get(node).label },
    windowHours,
    areas: areas.sort((a, b) => b.count - a.count),
    other: (byPlace.get('other') || []).filter((p) => Date.parse(p.createdAt) >= winStart).length,
    feed,
  };
}

const round1 = (x) => Math.round(x * 10) / 10;

/** A story's headline: an article's title, a link card's title, or a post's first sentence. */
export function headlineOf(p) {
  const raw = (p.source !== 'news' && p.linkTitle) || p.text || '';
  const t = String(raw).replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.{20,180}?[.!?])(?=\s|$)/);
  const out = m ? m[1] : t;
  return out.length > 180 ? `${out.slice(0, 179)}…` : out;
}

/**
 * "Last 24 hours" for a region, built from the data (no AI): how many stories,
 * how many are confirmed or disputed, what's new, the pace, and the stories
 * the most sources are covering. Storylines come from buildStorylines, which
 * joins posts and articles about the same event by links, quotes and wording.
 */
export function regionSummary({ posts, hierarchy: h, node, now, recentHours = 6, lookbackHours = 24 }) {
  const under = new Set(h.descendants(node));
  const scope = new Set([node, ...under]);
  const t = now.getTime();
  const lookStart = t - lookbackHours * HOUR;
  const recentStart = t - recentHours * HOUR;
  const day = posts.filter((p) => {
    const at = Date.parse(p.createdAt);
    return scope.has(p.topicId) && at >= lookStart && at <= t + 5 * 60_000;
  });
  const stories = buildStorylines(day);
  const recent = day.filter((p) => Date.parse(p.createdAt) >= recentStart).length;
  const earlier = day.length - recent;
  const placeLabel = (group) => {
    const counts = new Map();
    for (const p of group) {
      const id = placeOf(h, p.topicId, under);
      if (id) counts.set(id, (counts.get(id) || 0) + 1);
    }
    const [id] = [...counts].sort((a, b) => b[1] - a[1])[0] || [];
    return id ? { id, label: h.get(id).label, count: counts.get(id) } : null;
  };
  const ranked = [...stories].sort((a, b) => b.sources.length - a.sources.length || b.posts.length - a.posts.length || b.score - a.score);
  return {
    hours: lookbackHours,
    recentHours,
    posts: day.length,
    articles: day.filter((p) => p.source === 'news').length,
    sources: new Set(day.filter((p) => p.voice).map((p) => p.voice.affiliation)).size,
    stories: stories.length,
    confirmed: stories.filter((s) => s.status === 'corroborated' || s.status === 'official').length,
    disputed: stories.filter((s) => s.status === 'disputed').length,
    newStories: stories.filter((s) => Date.parse(s.firstSeen) >= recentStart).length,
    // Last few hours against the rest of the day; null without earlier posts.
    pace: earlier && recent ? round1(recent / recentHours / (earlier / (lookbackHours - recentHours))) : null,
    busiestPlace: placeLabel(day),
    top: ranked.slice(0, 3).map((s) => ({
      headline: headlineOf(s.lead),
      url: s.lead.url,
      status: s.status,
      sources: s.sources,
      posts: s.posts.length,
      articles: s.posts.filter((p) => p.source === 'news').length,
      place: placeLabel(s.posts),
      firstSeen: s.firstSeen,
      lastSeen: s.lastSeen,
    })),
  };
}

/** Regions under a node that have their own map (Middle East, Eastern Europe…). */
export function regionsOf(h, root) {
  const under = new Set([root, ...h.descendants(root)]);
  // In the order the hierarchy file lists them.
  return [...h.nodes.keys()].filter((id) => under.has(id) && h.get(id).map && h.get(id).place);
}

/**
 * The world map: one bubble per region, adding up its places.
 * Same shape as liveView, so the page draws both the same way.
 */
export function worldView({ posts, hierarchy: h, node, now, windowHours = 1, lookbackHours = 24 }) {
  const areas = regionsOf(h, node).map((id) => {
    const v = liveView({ posts, hierarchy: h, node: id, now, windowHours, lookbackHours });
    const count = v.areas.reduce((s, a) => s + a.count, 0);
    const perHour = v.areas.reduce((s, a) => s + a.perHour, 0);
    const usual = v.areas.reduce((s, a) => s + a.usualPerHour, 0);
    const share = (st) => v.areas.filter((a) => a.status === st).reduce((s, a) => s + a.count, 0) / Math.max(count, 1);
    const status = !count ? 'quiet' : share('disputed') >= 0.3 ? 'disputed' : share('corroborated') >= 0.5 ? 'corroborated' : 'reported';
    return {
      id,
      region: true,
      label: h.get(id).label,
      place: h.get(id).place,
      count,
      perHour: Math.round(perHour * 10) / 10,
      usualPerHour: Math.round(usual * 10) / 10,
      pace: usual > 0 ? Math.round((perHour / usual) * 10) / 10 : null,
      status,
      busiest: v.areas.filter((a) => a.count).slice(0, 3).map((a) => a.label),
      storylines: [],
    };
  });
  const scope = new Set([node, ...h.descendants(node)]);
  const regionOf = (topicId) => regionsOf(h, node).find((r) => r === topicId || h.descendants(r).includes(topicId)) || null;
  const lookStart = now.getTime() - lookbackHours * HOUR;
  const feed = posts
    .filter((p) => scope.has(p.topicId) && Date.parse(p.createdAt) >= lookStart)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 30)
    .map((p) => ({ ...postLine(p, h), area: regionOf(p.topicId) }));
  return {
    generatedAt: now.toISOString(),
    node: { id: node, label: 'the world' },
    windowHours,
    areas: areas.sort((a, b) => b.count - a.count),
    other: 0,
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
export function makeLive({ client, hierarchy: h, voices, node = 'geopolitics', lookbackHours = 24, loadNews = async () => null }) {
  let posts = [];
  let voiceIndex = new Map();
  let meta = { voices: 0, articles: 0, outlets: 0, newsUpdatedAt: null, missingVoices: [], errors: [] };

  return {
    /** Full reload from Bluesky (author feeds of every voice). */
    async load(now = new Date()) {
      let news = null;
      const newsErrors = [];
      try {
        news = await loadNews();
      } catch (err) {
        newsErrors.push(`news: ${err.message}`);
      }
      const brief = await buildBrief({
        news: news || undefined,
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
      const articles = brief.posts.filter((p) => p.source === 'news');
      meta = {
        voices: brief.voices.length,
        articles: articles.length,
        outlets: new Set(articles.map((p) => p.did)).size,
        newsUpdatedAt: news?.generatedAt || null,
        missingVoices: brief.missingVoices,
        errors: [...newsErrors, ...brief.errors],
      };
    },
    /** DIDs to ask Jetstream for. */
    dids: () => [...voiceIndex.keys()],
    /** A post from Jetstream. Returns true if it's on topic and was added. */
    add(post) {
      const voice = voiceIndex.get(post.did);
      if (!voice || posts.some((p) => p.uri === post.uri)) return false;
      const hits = h.classify(post, node);
      if (!hits.length) return false;
      const [ranked] = rankPosts([{ ...post, handle: post.handle || voice.handle, displayName: post.displayName || voice.name }], {
        voices: voiceIndex,
      });
      posts.push({ ...ranked, topicId: hits[0].id, matchedTerms: hits.flatMap((m) => m.terms) });
      return true;
    },
    /** Regions with a map, for the view switcher. */
    regions: () => regionsOf(h, node).map((id) => ({ id, label: h.get(id).label, map: h.get(id).map })),
    /** region: a region node id, or "world" for one bubble per region. */
    view({ now = new Date(), windowHours = 1, region = 'world' } = {}) {
      const args = { posts, hierarchy: h, now, windowHours, lookbackHours };
      const world = region === 'world' || !h.nodes.has(region);
      const v = world ? worldView({ ...args, node }) : liveView({ ...args, node: region });
      const summary = world ? null : regionSummary({ posts, hierarchy: h, node: region, now, lookbackHours });
      return { ...v, summary, ...meta };
    },
  };
}
