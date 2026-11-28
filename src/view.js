// Turn a brief (see brief.js) into the JSON the briefing web page renders.
// Kept separate from the server so it's easy to test and to reuse.

import { alertOf, headlineOf, isTopic, segmentOf, stageTrack, trail } from './live.js?v=2440a9a4e1';
import { TIER_NAME } from './voices.js?v=2440a9a4e1';

const HOUR = 3_600_000;
// Story statuses that make the Key developments list.
const DEVELOPMENT = new Set(['corroborated', 'official', 'disputed']);

function postView(p) {
  return {
    uri: p.uri,
    url: p.url,
    text: p.text,
    handle: p.handle,
    displayName: p.displayName,
    createdAt: p.createdAt,
    counts: p.counts,
    news: p.source === 'news',
    telegram: Boolean(p.telegram),
    topicId: p.topicId,
    lenses: p.lenses || [],
    voice: p.voice
      ? {
          name: p.voice.name,
          tier: TIER_NAME[p.voice.tier],
          affiliation: p.voice.affiliation,
          region: p.voice.region,
          stateAffiliated: p.voice.stateAffiliated,
          country: p.voice.country,
          independence: p.voice.independence,
          partyTo: p.voice.partyTo,
          cred: p.voice.cred,
          verified: Boolean(p.voice.verified),
        }
      : null,
    why: p.why && {
      lift: Number(p.why.lift.toFixed(2)),
      amplifiedBy: p.why.amplifiedBy,
    },
  };
}

function disagreementView(d) {
  if (d.type === 'pushback') {
    return {
      type: 'pushback',
      from: { handle: d.from.handle, affiliation: d.from.voice.affiliation, text: d.from.text, url: d.from.url },
      to: { handle: d.to.handle, affiliation: d.to.voice.affiliation, text: d.to.text, url: d.to.url },
    };
  }
  return {
    type: 'numbers',
    kind: d.kind,
    sides: d.sides.map((s) => ({ value: s.value, sources: s.sources, url: s.post.url, at: s.post.createdAt })),
  };
}

/** Posts per hour for the last `hours` hours, oldest first. */
export function activity(posts, now, hours = 24) {
  const start = Math.floor(now / HOUR) * HOUR - (hours - 1) * HOUR;
  const buckets = Array.from({ length: hours }, (_, i) => ({ hour: new Date(start + i * HOUR).toISOString(), count: 0 }));
  for (const p of posts) {
    const i = Math.floor((Date.parse(p.createdAt) - start) / HOUR);
    if (i >= 0 && i < hours) buckets[i].count++;
  }
  return buckets;
}

/** Share of on-topic posts from tracked voices, by the voice's region. */
export function coverage(posts) {
  const counts = new Map();
  let total = 0;
  for (const p of posts) {
    if (!p.voice) continue;
    counts.set(p.voice.region, (counts.get(p.voice.region) || 0) + 1);
    total++;
  }
  return [...counts.entries()]
    .map(([region, n]) => ({ region, posts: n, share: n / total }))
    .sort((a, b) => b.posts - a.posts);
}

/**
 * @param {Awaited<ReturnType<import('./brief.js').buildBrief>>} brief
 * @param {ReturnType<import('./hierarchy.js').makeHierarchy>} h
 */
export function briefView(brief, h, { now = new Date() } = {}) {
  const id = brief.node.id;
  const crumbs = [];
  for (let n = h.get(id); ; n = h.get(n.parents[0])) {
    crumbs.unshift({ id: n.id, label: n.label });
    if (!n.parents.length) break;
  }
  const stories = brief.stories.map((s) => ({ s, alert: alertOf(s, now) })).map(({ s, alert }) => ({
    // Stable id for "since you last checked": the storyline's earliest post.
    id: [...s.posts].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0].uri,
    status: s.status,
    // sides whose claim this is (country codes), for "Iran claims"
    claimedBy: s.claimedBy,
    // what each side says, and who reported first (src/storylines.js sidesOf)
    sides: s.sides || [],
    firstClaim: s.firstClaim || null,
    firstWitness: s.firstWitness || null,
    // independent sources reporting it if it's breaking (or hot) right now, else 0
    breaking: alert?.kind === 'breaking' ? alert.outlets : 0,
    hot: alert?.kind === 'hot' ? alert.outlets : 0,
    lead: postView(s.lead),
    // a clean one-line headline: article or link-card title, else the post's first sentence, no web addresses
    headline: headlineOf(s.lead),
    topicId: s.lead.topicId,
    topicLabel: h.get(s.lead.topicId).label,
    lenses: [...new Set(s.posts.flatMap((p) => p.lenses || []))],
    // One chip per outlet: a reporter and their outlet are not two sources.
    sources: [...new Map(s.voices.map((v) => [v.affiliation, { affiliation: v.affiliation, region: v.region, stateAffiliated: v.stateAffiliated, country: v.country, independence: v.independence, partyTo: v.partyTo, cred: v.cred }])).values()],
    firstSeen: s.firstSeen,
    lastSeen: s.lastSeen,
    postCount: s.posts.length,
    // every post's uri, so the page can find this storyline's stored timeline (stories.json)
    uris: s.posts.slice(0, 200).map((p) => p.uri),
    articleCount: s.posts.filter((p) => p.source === 'news').length,
    voiceCount: s.voices.length,
    disagreements: s.disagreements.map(disagreementView),
    related: s.posts.slice(1, 4).map(postView),
  }));
  // Breaking news goes first, then hot (stable: the rest keep their ranking).
  const rank = (x) => (x.breaking ? 2 : x.hot ? 1 : 0);
  stories.sort((a, b) => rank(b) - rank(a));
  // Where the node sits on the live map: region > broad topic > story.
  const onMap = trail(h, id);
  const seg = segmentOf(h, id);
  const kind = !onMap.length ? null : onMap.length === 1 ? 'region' : isTopic(h, id) ? 'topic' : 'story';
  const confirmed = stories.filter((s) => s.status === 'corroborated' || s.status === 'official').length;
  return {
    generatedAt: now.toISOString(),
    since: brief.since,
    node: { id, label: brief.node.label, path: brief.path, about: h.get(id).about || '', kind },
    // Where an ongoing fight stands (a court case, a bill), from these reports.
    track: stageTrack(h.get(id), brief.posts),
    // The live map view to go back to, and the bubble to pick there.
    map: !kind
      ? (seg && seg !== 'geo' ? { view: 'world', area: null, segment: seg } : null)
      : { ...(kind === 'story' ? { view: onMap.at(-2).id, area: id } : { view: h.get(id).place ? id : 'world', area: null }), segment: seg },
    // The mini map at the top of the page (in place of the 24-hour dial, Amir 27 Nov 2026).
    mini: miniMap(h, onMap, id, kind, stories),
    // "What changed", built from the data (no AI).
    recap: {
      updates: stories.length,
      confirmed,
      disputed: stories.filter((s) => s.status === 'disputed').length,
      sources: new Set(stories.flatMap((s) => s.sources.map((x) => x.affiliation))).size,
      latest: stories.length ? stories.map((s) => s.lastSeen).sort().at(-1) : null,
      top: [...stories].sort((a, b) => b.sources.length - a.sources.length || b.postCount - a.postCount)[0]?.lead.text || null,
    },
    crumbs,
    parent: crumbs.length > 1 ? crumbs.at(-2) : null,
    children: h.children(id).map((c) => ({ id: c, label: h.get(c).label })),
    breadth: { ...brief.breadth, perChild: Number.isFinite(brief.breadth.perChild) ? brief.breadth.perChild : null },
    stats: {
      voices: brief.voices.length,
      scanned: brief.scanned,
      onTopic: brief.posts.length,
      articles: brief.posts.filter((p) => p.source === 'news').length,
      outlets: new Set(brief.posts.filter((p) => p.source === 'news').map((p) => p.did)).size,
    },
    newsUpdatedAt: brief.newsUpdatedAt || null,
    stories,
    activity: activity(brief.posts, now),
    coverage: coverage(brief.posts),
    // Key developments: confirmed, official or disputed stories only (one
    // independent source, or only a side's own claim, is not enough), the most
    // widely covered first, each with a clean headline and its latest update time.
    developments: stories
      .filter((s) => DEVELOPMENT.has(s.status))
      .map((s) => ({ at: s.lastSeen, text: s.headline, status: s.status, url: s.lead.url, outlets: s.sources.length }))
      .sort((a, b) => b.outlets - a.outlets || Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 6),
    missingVoices: brief.missingVoices,
    errors: brief.errors,
  };
}

// Where a topic sits: its own place, or the nearest one above it inside the
// same region (a story with no place of its own sits at its topic or region).
function placeIn(h, id, regionId) {
  for (let n = h.get(id); n; n = n.parents.length ? h.get(n.parents[0]) : null) {
    if (n.place) return n;
    if (n.id === regionId) return null;
  }
  return null;
}

const STATUS_RANK = { disputed: 3, corroborated: 2, official: 2, claimed: 1, reported: 1 };

/**
 * The mini map: the region's map view, the place this page is about, and one
 * pin per place with how many storylines sit there and the strongest status
 * among them (disputed > confirmed > reported). Null off the map.
 */
export function miniMap(h, onMap, id, kind, stories) {
  if (!kind) return null;
  const region = h.get(onMap[0].id);
  const pins = new Map();
  for (const s of stories) {
    const at = s.topicId && h.nodes.has(s.topicId) ? placeIn(h, s.topicId, region.id) : null;
    if (!at) continue;
    const pin = pins.get(at.id) || { id: at.id, label: at.label, lon: at.place.lon, lat: at.place.lat, count: 0, status: 'reported' };
    pin.count += 1;
    if ((STATUS_RANK[s.status] || 0) > (STATUS_RANK[pin.status] || 0)) pin.status = s.status === 'official' ? 'corroborated' : s.status;
    pins.set(at.id, pin);
  }
  const here = kind === 'region' ? null : placeIn(h, id, region.id);
  return {
    view: region.map,
    focus: here ? { id: here.id, lon: here.place.lon, lat: here.place.lat } : null,
    pins: [...pins.values()].sort((a, b) => b.count - a.count),
  };
}
