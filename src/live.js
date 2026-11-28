// The live map: how much the tracked voices are posting about each place
// in a region (Gaza, Kyiv, the Taiwan Strait…) right now, compared
// with their usual pace, plus the newest posts as they arrive.
//
// It reuses the briefing pipeline (brief.js) for the first load, then keeps
// up through Jetstream: a WebSocket of new posts filtered to the voices'
// accounts, which works straight from the browser. Read-only, no login.

import { buildBrief } from './brief.js?v=d783955726';
import { KEEP_PER_VOICE } from './snapshot.js?v=d783955726';
import { rankPosts } from './rank.js?v=d783955726';
import { buildStorylines } from './storylines.js?v=d783955726';
import { byDid } from './voices.js?v=d783955726';
import { conflictOfNode, roleOf } from './credibility.js?v=d783955726';

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

/** How many posts name each of a node's spots (cities); only the ones named. */
export function spotCounts(n, posts) {
  if (!n.spots?.length) return [];
  return n.spots
    .map((s) => ({
      name: s.name,
      place: { lon: s.lon, lat: s.lat },
      count: posts.filter((p) => {
        const text = `${p.linkTitle || ''} ${p.text || ''}`.toLowerCase();
        const tags = new Set((p.tags || []).map((t) => t.toLowerCase()));
        return s.test.some((t) => t(text, tags));
      }).length,
    }))
    .filter((s) => s.count)
    .sort((a, b) => b.count - a.count);
}

/**
 * How far an ongoing fight has got (a lawsuit, a bill, a funding deadline):
 * the furthest of a story's stages that recent posts mention, or null when
 * the story has no stages or nothing names one. Based only on the words
 * reports use, so it is a guide, not an official record.
 */
export function stageTrack(n, posts) {
  if (!n.stages?.length || !posts.length) return null;
  const hits = n.stages.map((st) => posts.filter((p) => {
    const text = `${p.linkTitle || ''} ${p.text || ''}`.toLowerCase();
    const tags = new Set((p.tags || []).map((t) => t.toLowerCase()));
    return st.test.some((t) => t(text, tags));
  }));
  let at = -1;
  hits.forEach((list, i) => { if (list.length) at = i; });
  if (at < 0) return null;
  const latest = [...hits[at]].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  return { stages: n.stages.map((st) => st.label), at, label: n.stages[at].label, mentions: hits[at].length, latest: latest.createdAt, url: latest.url };
}

/** The nodes drawn as bubbles when a node is on screen: its children that have a place. */
export function mapChildren(h, node) {
  return h.children(node).filter((id) => h.get(id).place);
}

/** Which of `node`'s bubbles a topic rolls up to (itself or the child it sits under), or null. */
export function childOf(h, topicId, node) {
  const kids = mapChildren(h, node);
  if (kids.includes(topicId)) return topicId;
  return kids.find((k) => h.descendants(k).includes(topicId)) || null;
}

/**
 * Broad topics: a region's bubbles that hold stories of their own ("War in
 * Iran" holds "Strait of Hormuz"). Clicking one zooms in to its stories; a
 * bubble without stories (Syria) is a story itself.
 */
export function isTopic(h, id) {
  if (!h.nodes.has(id)) return false;
  const n = h.get(id);
  return !n.map && n.parents.some((p) => h.get(p).map) && mapChildren(h, id).length > 0;
}

/**
 * The site's main segments: each is a node with its own home view
 * (Geopolitics on the world map, US politics on its arenas).
 * The key is what the page URL carries (?segment=us).
 */
export const SEGMENTS = { geo: 'geopolitics', us: 'us-politics', ca: 'ca-politics' };

/** Which segment a node belongs to ("geo", "us" or "ca"), or null. */
export function segmentOf(h, id) {
  if (!h.nodes.has(id)) return null;
  const up = new Set([id, ...h.ancestors(id)]);
  return Object.keys(SEGMENTS).find((k) => up.has(SEGMENTS[k])) || null;
}

/** Where a node sits: its region and, for a story, its broad topic. */
export function trail(h, id) {
  if (!h.nodes.has(id)) return [];
  const out = [];
  for (let n = h.get(id); n; n = n.parents.length ? h.get(n.parents[0]) : null) {
    out.unshift({ id: n.id, label: n.label });
    if (n.map) break;
  }
  return out[0] && h.get(out[0].id).map ? out : [];
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
    country: p.voice?.country,
    independence: p.voice?.independence || 'independent',
    partyTo: p.voice?.partyTo || [],
    cred: p.voice?.cred,
    lean: p.voice?.lean || null,
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
  const t = now.getTime();
  const winStart = t - windowHours * HOUR;
  const lookStart = t - lookbackHours * HOUR;
  const byPlace = new Map();
  for (const p of posts) {
    const at = Date.parse(p.createdAt);
    if (!(at >= lookStart && at <= t + 5 * 60_000)) continue;
    if (!scope.has(p.topicId)) continue;
    // One bubble per child of the node: a region shows its broad topics,
    // a broad topic its stories. Posts about the node itself go to "other".
    const place = childOf(h, p.topicId, node) || 'other';
    if (!byPlace.has(place)) byPlace.set(place, []);
    byPlace.get(place).push(p);
  }

  const places = mapChildren(h, node);
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
      about: n.about,
      place: n.place,
      // a broad topic: clicking zooms in to its stories
      topic: isTopic(h, id),
      // a region with its own map (Washington on the US map)
      region: Boolean(n.map),
      // a small 3D model of the place (the White House…) instead of a plain bubble
      icon: n.icon,
      breaking: 0, // set by makeLive.view from alertNews
      hot: 0,
      stories: mapChildren(h, id).length,
      count: recent.length,
      perHour: Math.round(perHour * 10) / 10,
      usualPerHour: Math.round(usual * 10) / 10,
      // null when there's no history to compare with
      pace: usual > 0 ? Math.round((perHour / usual) * 10) / 10 : null,
      status: overallStatus(stories),
      voices: new Set(recent.filter((p) => p.voice).map((p) => p.voice.affiliation)).size,
      latest: recent.length ? recent.map((p) => p.createdAt).sort().at(-1) : null,
      // Cities this story spans, with how many of its posts name each one.
      spots: spotCounts(n, recent),
      // Where an ongoing fight stands, from the last day's reports.
      track: stageTrack(n, all),
      storylines: stories.slice(0, 3).map((s) => ({
        status: s.status,
        text: s.lead.text,
        url: s.lead.url,
        by: s.lead.voice?.name || s.lead.handle,
        news: s.lead.source === 'news',
        telegram: Boolean(s.lead.telegram),
        articles: s.posts.filter((p) => p.source === 'news').length,
        sources: s.sources,
        flags: s.flags,
        creds: s.creds,
        claimedBy: s.claimedBy,
        posts: s.posts.length,
        firstSeen: s.firstSeen,
      })),
    };
  });

  const feed = posts
    .filter((p) => scope.has(p.topicId) && Date.parse(p.createdAt) >= lookStart)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 30)
    .map((p) => ({ ...postLine(p, h), area: childOf(h, p.topicId, node) }));

  const inWindow = posts.filter((p) => {
    const at = Date.parse(p.createdAt);
    return scope.has(p.topicId) && at >= winStart && at <= t + 5 * 60_000;
  });
  return {
    generatedAt: now.toISOString(),
    node: { id: node, label: h.get(node).label, about: h.get(node).about, topic: isTopic(h, node) },
    trail: trail(h, node),
    links: linksBetween(h, inWindow, node),
    windowHours,
    areas: areas.sort((a, b) => b.count - a.count),
    other: (byPlace.get('other') || []).filter((p) => Date.parse(p.createdAt) >= winStart).length,
    feed,
  };
}

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Stories that touch two of a node's bubbles (a court blocks an executive
 * order: Courts and the White House), drawn as arcs between them. A story
 * counts for every bubble its posts were classified under, so one post
 * about a tariff ruling links both. Busiest pairs first.
 */
export function linksBetween(h, posts, node, { max = 5, minPosts = 2 } = {}) {
  const pairs = new Map();
  for (const s of buildStorylines(posts)) {
    const where = new Set();
    for (const p of s.posts) for (const id of p.topicIds || [p.topicId]) {
      const c = childOf(h, id, node);
      if (c) where.add(c);
    }
    const ids = [...where].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}|${ids[j]}`;
        const cur = pairs.get(key) || { from: ids[i], to: ids[j], stories: 0, posts: 0, lead: null };
        cur.stories += 1;
        cur.posts += s.posts.length;
        if (!cur.lead || s.posts.length > cur.lead.posts.length) cur.lead = s;
        pairs.set(key, cur);
      }
    }
  }
  return [...pairs.values()]
    .filter((x) => x.posts >= minPosts)
    .sort((a, b) => b.posts - a.posts)
    .slice(0, max)
    .map(({ lead, ...x }) => ({ ...x, headline: headlineOf(lead.lead), url: lead.lead.url, topicId: mainTopic(lead.posts) }));
}

/** The topic most of a group of posts sit under. */
function mainTopic(posts) {
  const counts = new Map();
  for (const p of posts) counts.set(p.topicId, (counts.get(p.topicId) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

/**
 * Text without web addresses: posts often end with a link ("… reut.rs/49j0Gtm",
 * "https://aje.news/w1pb…"), which reads as clutter in a headline.
 */
export function stripLinks(text) {
  return String(text || '')
    .replace(/(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}\/\S*/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/[\s:,;\-–—|]+$/, '')
    .trim();
}

/** A story's headline: an article's title, a link card's title, or a post's first sentence. */
export function headlineOf(p) {
  const raw = (p.source !== 'news' && p.linkTitle) || p.text || '';
  const t = stripLinks(raw);
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
export function regionSummary({ posts, hierarchy: h, node, now, recentHours = 6, lookbackHours = 24, topN = 3 }) {
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
    top: ranked.slice(0, topN).map((s) => ({
      headline: headlineOf(s.lead),
      url: s.lead.url,
      status: s.status,
      sources: s.sources,
      flags: s.flags,
      creds: s.creds,
      claimedBy: s.claimedBy,
      posts: s.posts.length,
      articles: s.posts.filter((p) => p.source === 'news').length,
      place: placeLabel(s.posts),
      topicId: mainTopic(s.posts),
      firstSeen: s.firstSeen,
      lastSeen: s.lastSeen,
    })),
  };
}

// Breaking and Hot (Amir, 27 Nov 2026). The old single rule (3 outlets within
// 90 minutes, 24 Nov) flagged what was really "hot": lots of outlets on the
// same thing. Now there are two labels, both of which push:
//
//   Breaking  a new event in its first hour. The storyline (built over the
//             last day, so an older story can't look new) starts with a report
//             from an independent source, and at least 2 independent sources
//             report an event (killed, strike, seized, resigns...) within 30
//             minutes of that first report. Statements ("X says", "X urges"),
//             plans and old news ("last week") don't count. It lasts 1 hour
//             from the moment the second source came in.
//   Hot       widely covered right now: 4+ independent sources in the last 6
//             hours, or 3+ while its topic runs at 2x its usual pace, and a
//             report in the last 2 hours. Statements can be hot.
//
// Independent sources are what can confirm a story (src/credibility.js roleOf):
// outlets, reporters, OSINT and neutral officials. Analysts, partisan and
// state-controlled outlets, and a side's own claims don't count; state media
// from one country count once. Claimed and disputed storylines are neither.
export const BREAKING = { lookbackHours: 24, withinMinutes: 30, witnesses: 2, lastsMinutes: 60 };
export const HOT = { windowHours: 6, witnesses: 4, paceWitnesses: 3, pace: 2, paceHours: 2, paceMinPosts: 6, activeHours: 2 };

/** Outlets: one per affiliation, one per country for state media (for counting reach). */
export function outletKey(p) {
  const v = p.voice;
  if (!v) return p.did || p.handle || null;
  return v.stateAffiliated && v.country ? `state:${v.country}` : v.affiliation || p.did;
}

/** The independent source a post counts as, or null (analysts, echoes, claims, unknown accounts). */
export function witnessOf(p, conflict) {
  return roleOf(p, conflict ?? p.conflict).witness || null;
}

// Words that say something happened. Kept to concrete events; a story that
// only has statements can still be hot.
const EVENT_RE = new RegExp(
  '\\b(?:' + [
    'kill(?:s|ed|ing)?', 'dead', 'dies', 'died', 'death toll', 'wounded', 'injured', 'casualties',
    'strikes?', 'struck', 'airstrikes?', 'attack(?:s|ed)?', 'explosions?', 'blasts?', 'explode[sd]?', 'bomb(?:s|ed|ing)?',
    'shell(?:s|ed|ing)', 'shoots? down', 'shot down', 'intercept(?:s|ed)', 'downed', 'fired', 'launch(?:es|ed)',
    'seiz(?:e|es|ed)', 'captur(?:e|es|ed)', 'hijack(?:s|ed)?', 'invad(?:e|es|ed)', 'incursion', 'raid(?:s|ed)?', 'ambush(?:es|ed)?',
    'hostages?', 'crash(?:es|ed)?', 'sinks?', 'sank', 'sunk', 'hit(?:s)?', 'evacuat\\w*', 'earthquake',
    'resign(?:s|ed)?', 'ousted', 'assassinat\\w*', 'arrest(?:s|ed)?', 'detain(?:s|ed)', 'coup', 'ceasefire', 'truce',
    'clos(?:e|es|ed) (?:the |its |two |all )?(?:border|airspace|strait|crossings?|embassy)', 'violat(?:es|ed) (?:\\w+ )?airspace',
    'deploy(?:s|ed)', 'mobiliz\\w*', 'declares?', 'released', 'freed',
    'passe[sd]', 'vetoe[sd]', 'signs?', 'signed', 'blocks?', 'blocked', 'struck down', 'ruled?', 'rules', 'verdict', 'convicted', 'sentenced',
    'indicted', 'impeach(?:ed)?', 'upholds?', 'upheld', 'overturn(?:s|ed)', 'strikes down', 'elected', 'wins', 'won', 'confirmed as', 'shutdown begins',
  ].join('|') + ')\\b',
  'i',
);
// Plans and maybes before the event word ("plans to", "threatens to").
const MAYBE_RE = /\b(?:plans?|planning|threatens?|threatening|would|could|may|might|considering|weighs|mulls|proposes?|wants?|urges?|calls? for|vows?|warns?|if)\b/i;
// Old news and anniversaries.
const OLD_RE = /\b(?:last (?:week|month|year)|yesterday|earlier this (?:week|month|year)|years? ago|anniversary|posthumous\w*|in (?:january|february|march|april|may|june|july|august|september|october|november|december) 20\d\d|in 20\d\d)\b/i;

/** The headline-ish text of a post (an article's title, a link card's title, or the post itself). */
function eventText(p) {
  const t = p.source === 'news' ? p.title || p.text : `${p.linkTitle || ''} ${p.text || ''}`;
  return stripLinks(t).slice(0, 300);
}

/** Does this text report a concrete event that just happened? */
export function isEventText(text) {
  const t = String(text || '');
  if (OLD_RE.test(t)) return false;
  const m = EVENT_RE.exec(t);
  if (!m) return false;
  const maybe = MAYBE_RE.exec(t);
  return !(maybe && maybe.index < m.index);
}

const timeOf = (p) => Date.parse(p.createdAt);

/**
 * Breaking? Returns {at (ms, when it broke), witnesses} or null.
 * `s` must be built over the last day of posts, so an older story isn't new.
 */
export function breakingOf(s, now, rules = BREAKING) {
  if (s.status === 'disputed' || s.status === 'claimed') return null;
  const t = now.getTime();
  const byTime = s.posts.filter((p) => !Number.isNaN(timeOf(p))).sort((a, b) => timeOf(a) - timeOf(b));
  const conflict = s.conflict;
  // The first independent report anchors it; a side's claims may come before.
  const first = byTime.find((p) => witnessOf(p, conflict));
  if (!first) return null;
  const start = timeOf(first);
  const seen = new Set();
  let at = null;
  for (const p of byTime) {
    if (timeOf(p) < start) continue;
    if (timeOf(p) - start > rules.withinMinutes * 60_000) break;
    const w = witnessOf(p, conflict);
    if (!w || !isEventText(eventText(p))) continue;
    seen.add(w);
    if (seen.size >= rules.witnesses) { at = timeOf(p); break; }
  }
  if (at == null || at > t + 5 * 60_000 || t - at >= rules.lastsMinutes * 60_000) return null;
  return { at, witnesses: new Set(s.posts.map((p) => witnessOf(p, conflict)).filter(Boolean)).size };
}

/**
 * Hot? Returns {witnesses} or null. `topicPace` is how fast the storyline's
 * topic runs against its usual (null when unknown).
 */
export function hotOf(s, now, { topicPace = null, rules = HOT } = {}) {
  if (s.status === 'disputed' || s.status === 'claimed') return null;
  const t = now.getTime();
  const recent = s.posts.filter((p) => t - timeOf(p) < rules.windowHours * HOUR && timeOf(p) <= t + 5 * 60_000);
  if (!recent.some((p) => t - timeOf(p) < rules.activeHours * HOUR)) return null;
  const n = new Set(recent.map((p) => witnessOf(p, s.conflict)).filter(Boolean)).size;
  if (n >= rules.witnesses || (n >= rules.paceWitnesses && topicPace != null && topicPace >= rules.pace)) return { witnesses: n };
  return null;
}

/** 'breaking' | 'hot' | null, with the independent sources reporting it. */
export function alertOf(s, now, { topicPace = null } = {}) {
  const b = breakingOf(s, now);
  if (b) return { kind: 'breaking', outlets: b.witnesses, at: b.at };
  const hot = hotOf(s, now, { topicPace });
  return hot ? { kind: 'hot', outlets: hot.witnesses } : null;
}

/** Outlets on a breaking storyline right now, or 0 (kept for older callers). */
export function breakingCount(s, now) {
  return breakingOf(s, now)?.witnesses || 0;
}

/** How fast each topic under a node runs: posts in the last `paceHours` per hour against the rest of the day. */
function topicPaces(posts, h, now, rules = HOT, lookbackHours = BREAKING.lookbackHours) {
  const t = now.getTime();
  const counts = new Map();
  for (const p of posts) {
    const age = t - timeOf(p);
    if (!(age < lookbackHours * HOUR)) continue;
    for (const id of [p.topicId, ...h.ancestors(p.topicId)]) {
      const c = counts.get(id) || { recent: 0, earlier: 0 };
      if (age < rules.paceHours * HOUR) c.recent++; else c.earlier++;
      counts.set(id, c);
    }
  }
  const pace = new Map();
  for (const [id, c] of counts) {
    if (c.recent < rules.paceMinPosts) continue;
    const usual = c.earlier / (lookbackHours - rules.paceHours);
    pace.set(id, usual > 0 ? c.recent / rules.paceHours / usual : Infinity);
  }
  return pace;
}

/**
 * Breaking and hot updates under a node: breaking first, then most sources.
 * Each has `kind` ('breaking' | 'hot') and names the node its posts are mostly
 * about (a story, else a topic or region) so the map can point at it.
 */
export function alertNews({ posts, hierarchy: h, node, now, lookbackHours = BREAKING.lookbackHours }) {
  const scope = new Set([node, ...h.descendants(node)]);
  const t = now.getTime();
  const recent = posts.filter((p) => scope.has(p.topicId) && t - timeOf(p) < lookbackHours * HOUR && timeOf(p) <= t + 5 * 60_000);
  const paces = topicPaces(recent, h, now);
  return buildStorylines(recent)
    .map((s) => ({ s, a: alertOf(s, now, { topicPace: paces.get(mainTopic(s.posts)) ?? null }) }))
    .filter((x) => x.a)
    .sort((x, y) => Number(y.a.kind === 'breaking') - Number(x.a.kind === 'breaking') || y.a.outlets - x.a.outlets || Date.parse(y.s.firstSeen) - Date.parse(x.s.firstSeen))
    .map(({ s, a }) => {
      const topicId = mainTopic(s.posts);
      return {
        id: s.lead.uri,
        kind: a.kind,
        headline: headlineOf(s.lead),
        url: s.lead.url,
        outlets: a.outlets,
        // independent sources by name, for push notifications ("including Reuters and BBC")
        names: [...new Set(s.posts.filter((p) => witnessOf(p, s.conflict) && !p.voice.stateAffiliated).map((p) => p.voice.affiliation || p.voice.name).filter(Boolean))].slice(0, 3),
        uris: s.posts.map((p) => p.uri),
        status: s.status,
        firstSeen: s.firstSeen,
        ...(a.at ? { brokeAt: new Date(a.at).toISOString() } : {}),
        topicId,
        topicLabel: h.get(topicId).label,
        trail: trail(h, topicId).map((x) => x.id),
      };
    });
}

/** Only the breaking ones (see alertNews). */
export function breakingNews(o) {
  return alertNews(o).filter((x) => x.kind === 'breaking');
}

/** Only the hot ones (see alertNews). */
export function hotNews(o) {
  return alertNews(o).filter((x) => x.kind === 'hot');
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
    links: [],
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
  let alertCache = { key: null, list: [] };

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
        perVoice: KEEP_PER_VOICE,
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
      const hits = h.classify(post, node, voice);
      if (!hits.length) return false;
      const [ranked] = rankPosts([{ ...post, handle: post.handle || voice.handle, displayName: post.displayName || voice.name }], {
        voices: voiceIndex,
      });
      posts.push({ ...ranked, topicId: hits[0].id, conflict: conflictOfNode(h, hits[0].id), topicIds: hits.map((m) => m.id), matchedTerms: hits.flatMap((m) => m.terms) });
      return true;
    },
    /** Regions with a map, for the view switcher. */
    regions: () => regionsOf(h, node).map((id) => ({ id, label: h.get(id).label, map: h.get(id).map })),
    /** Broad topics in a region, with their stories (for links and checking URLs). */
    // A segment with its own home map (US politics) has topics right on it
    // (Elections, States); their region is "world", the home view.
    topics: () => [...(h.get(node).map ? [node] : []), ...regionsOf(h, node)]
      .flatMap((r) => mapChildren(h, r).filter((id) => isTopic(h, id))
        .map((id) => ({ id, label: h.get(id).label, region: r === node ? 'world' : r, stories: mapChildren(h, id) }))),
    /** The home map's id: the world for Geopolitics, the US for US politics. */
    home: () => h.get(node).map || 'world',
    /** The day's biggest stories under the segment (three, or `n`), one per place, for the guided tour and "Today's loop". */
    tour: ({ now = new Date(), n = 3 } = {}) => {
      const seen = new Set();
      return regionSummary({ posts, hierarchy: h, node, now, lookbackHours, topN: n * 3 }).top
        .filter((x) => x.topicId && x.topicId !== node && !seen.has(x.topicId) && seen.add(x.topicId))
        .slice(0, n);
    },
    /** Region > topic > story for a node, for breadcrumbs. */
    trail: (id) => trail(h, id),
    /** The 3D model a node is drawn as (the White House…), or null. */
    iconOf: (id) => (h.nodes.has(id) ? h.get(id).icon : null),
    /** Lon/lat of a node on the map, or null. */
    placeOf: (id) => (h.nodes.has(id) ? h.get(id).place : null),
    /**
     * region: a region node id, a broad topic id (one bubble per story),
     * or "world" for one bubble per region.
     */
    view({ now = new Date(), windowHours = 1, region = 'world' } = {}) {
      const args = { posts, hierarchy: h, now, windowHours, lookbackHours };
      const world = region === 'world' || !h.nodes.has(region) || !(h.get(region).map || isTopic(h, region));
      // A segment with its own map (US politics) shows its own children at
      // home; Geopolitics shows one bubble per region on the world map.
      const home = world && h.get(node).map;
      const v = world && !home ? worldView({ ...args, node }) : liveView({ ...args, node: world ? node : region });
      const summary = world && !home ? null : regionSummary({ posts, hierarchy: h, node: world ? node : region, now, lookbackHours });
      // Breaking and hot news anywhere we follow (the strip), and which bubbles
      // they sit under. Worked out over the last day, so kept for a minute.
      const key = `${posts.length}|${posts.at(-1)?.uri}|${Math.floor(now.getTime() / 60_000)}`;
      if (alertCache.key !== key) alertCache = { key, list: alertNews({ posts, hierarchy: h, node, now }) };
      const breaking = alertCache.list.filter((b) => b.kind === 'breaking');
      const hot = alertCache.list.filter((b) => b.kind === 'hot');
      for (const a of v.areas) {
        a.breaking = breaking.filter((b) => b.trail.includes(a.id)).length;
        a.hot = hot.filter((b) => b.trail.includes(a.id)).length;
      }
      return { ...v, summary, breaking, hot, ...meta };
    },
  };
}
