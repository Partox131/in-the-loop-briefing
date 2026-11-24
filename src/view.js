// Turn a brief (see brief.js) into the JSON the briefing web page renders.
// Kept separate from the server so it's easy to test and to reuse.

import { isTopic, trail } from './live.js?v=72b3fdad1a';
import { TIER_NAME } from './voices.js?v=72b3fdad1a';

const HOUR = 3_600_000;

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
  const stories = brief.stories.map((s) => ({
    // Stable id for "since you last checked": the storyline's earliest post.
    id: [...s.posts].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0].uri,
    status: s.status,
    lead: postView(s.lead),
    topicId: s.lead.topicId,
    topicLabel: h.get(s.lead.topicId).label,
    lenses: [...new Set(s.posts.flatMap((p) => p.lenses || []))],
    // One chip per outlet: a reporter and their outlet are not two sources.
    sources: [...new Map(s.voices.map((v) => [v.affiliation, { affiliation: v.affiliation, region: v.region, stateAffiliated: v.stateAffiliated, country: v.country }])).values()],
    firstSeen: s.firstSeen,
    lastSeen: s.lastSeen,
    postCount: s.posts.length,
    articleCount: s.posts.filter((p) => p.source === 'news').length,
    voiceCount: s.voices.length,
    disagreements: s.disagreements.map(disagreementView),
    related: s.posts.slice(1, 4).map(postView),
  }));
  // Where the node sits on the live map: region > broad topic > story.
  const onMap = trail(h, id);
  const kind = !onMap.length ? null : onMap.length === 1 ? 'region' : isTopic(h, id) ? 'topic' : 'story';
  const confirmed = stories.filter((s) => s.status === 'corroborated' || s.status === 'official').length;
  return {
    generatedAt: now.toISOString(),
    since: brief.since,
    node: { id, label: brief.node.label, path: brief.path, about: h.get(id).about || '', kind },
    // The live map view to go back to, and the bubble to pick there.
    map: !kind ? null : kind === 'story' ? { view: onMap.at(-2).id, area: id } : { view: id, area: null },
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
    developments: stories
      .filter((s) => s.status !== 'reported')
      .map((s) => ({ at: s.firstSeen, text: s.lead.text, status: s.status, url: s.lead.url }))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 6),
    missingVoices: brief.missingVoices,
    errors: brief.errors,
  };
}
