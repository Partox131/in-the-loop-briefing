// "Brief": what credible voices are saying about a topic node right now,
// grouped into storylines with a status and any disagreements.
//
//   voices on this node ──▶ getAuthorFeed (reliable) ─┐
//   topic terms ─────────▶ searchPosts (best effort) ─┤
//                                                      ▼
//                     classify into the hierarchy (deepest node wins)
//                                                      ▼
//                     rank (velocity vs author's usual, voice amplification, decay)
//                                                      ▼
//                     storylines (shared links, quote/reply chains) + status
//                                                      ▼
//                     breadth quota (fewer items per child higher up)

import { ago, bold, cyan, dim, formatPost, green, magenta, yellow } from './format.js?v=4841c59de7';
import { applyQuota, rankPosts } from './rank.js?v=4841c59de7';
import { searchTopic } from './search.js?v=4841c59de7';
import { KEEP_PER_VOICE } from './snapshot.js?v=4841c59de7';
import { buildStorylines } from './storylines.js?v=4841c59de7';
import { byDid, resolveVoices, TIER_NAME, voicesFor } from './voices.js?v=4841c59de7';

/**
 * @param {object} o
 * @param {import('./bsky.js').BskyClient} o.client
 * @param {ReturnType<import('./hierarchy.js').makeHierarchy>} o.hierarchy
 * @param {string} o.node
 * @param {import('./voices.js').Voice[]} o.voices   the whole registry
 * @param {Date} o.since
 * @param {Date} [o.now]
 * @param {boolean} [o.search]   also pull the open conversation via search (default true)
 * @param {{posts: Array, voices: Map}} [o.news]  news articles as posts (see news.js newsPosts)
 */
export async function buildBrief({ client, hierarchy: h, node, voices, since, now = new Date(), search = true, perVoice = KEEP_PER_VOICE, perTerm = 100, news }) {
  const breadth = h.breadth(node);
  const scope = new Set([node, ...h.descendants(node)]);
  const errors = [];

  const { voices: active, missing, errors: lookupErrors } = await resolveVoices(client, voicesFor(voices, h, node));
  errors.push(...lookupErrors);
  const voiceIndex = byDid(active);
  // News outlets count as voices too (tier 1), keyed by "news:<domain>".
  for (const [did, v] of news?.voices || []) if (!voiceIndex.has(did)) voiceIndex.set(did, v);

  const collected = new Map();
  for (const v of active) {
    try {
      for (const p of await client.authorFeed(v.did, { since, max: perVoice })) collected.set(p.uri, p);
    } catch (err) {
      errors.push(`posts from @${v.handle}: ${err.message}`);
    }
  }
  if (search) {
    for (const topic of h.searchTopics(node)) {
      try {
        const { posts, errors: e } = await searchTopic(client, topic, { since, maxPerTerm: perTerm, sort: 'top' });
        for (const p of posts) if (!collected.has(p.uri)) collected.set(p.uri, p);
        errors.push(...e.map((x) => `search "${x.term}": ${x.error}`));
      } catch (err) {
        errors.push(`search for ${topic.label}: ${err.message}`);
      }
    }
  }

  let articles = 0;
  for (const p of news?.posts || []) {
    if (collected.has(p.uri)) continue;
    collected.set(p.uri, p);
    articles++;
  }

  // Which child of `node` does a matched topic sit under? Used for the quota.
  const childUnder = (id) =>
    id === node ? node : h.children(node).find((c) => c === id || h.descendants(c).includes(id)) ?? node;

  const onTopic = [];
  for (const p of collected.values()) {
    if (new Date(p.createdAt) < since) continue;
    const hits = h.classify(p, node, voiceIndex.get(p.did));
    if (!hits.length) continue; // e.g. a correspondent posting about something else
    const deepest = hits[0].id;
    onTopic.push({
      ...p,
      topicId: deepest,
      // Every topic it matched: a story touching two arenas links them on the map.
      topicIds: hits.map((m) => m.id),
      node: childUnder(deepest),
      matchedTerms: hits.flatMap((m) => m.terms),
      lenses: h.lensesFor(deepest, p),
    });
  }

  const ranked = rankPosts(onTopic, { voices: voiceIndex, now, halfLifeHours: breadth.halfLifeHours });
  const stories = applyQuota(buildStorylines(ranked), { ...breadth, childOf: (s) => s.lead.node });

  return {
    node: h.get(node),
    path: h.path(node),
    breadth,
    since: since.toISOString(),
    voices: active,
    missingVoices: missing,
    scanned: collected.size,
    articles,
    newsUpdatedAt: news?.generatedAt || null,
    posts: ranked,
    stories,
    errors,
  };
}

const STATUS = {
  corroborated: green('CORROBORATED'),
  official: cyan('OFFICIAL'),
  reported: yellow('REPORTED'),
  disputed: magenta('DISPUTED'),
};

export function formatBrief(b, { now = new Date() } = {}) {
  const lines = [];
  lines.push(bold(`━━ ${b.path} ━━`));
  lines.push(
    dim(
      `${b.voices.length} voices · ${b.scanned} posts scanned since ${ago(b.since, now)} · ` +
        `${b.posts.length} on topic · ${b.stories.length} storylines shown (half-life ${b.breadth.halfLifeHours}h)`,
    ),
  );
  if (!b.stories.length) lines.push('', 'Nothing on this topic from tracked voices in this window.');

  b.stories.forEach((s, i) => {
    const lenses = s.lead.lenses?.length ? dim(` [${s.lead.lenses.join(', ')}]`) : '';
    const where = s.lead.topicId !== b.node.id ? dim(` in ${s.lead.topicId}`) : '';
    lines.push('', `${bold(`${i + 1}.`)} ${STATUS[s.status]}${where}${lenses}`);
    if (s.sources.length) lines.push(`   ${dim('sources:')} ${s.sources.join(', ')}  ${dim('regions: ' + s.regions.join(', '))}`);
    lines.push(formatPost(s.lead, { now }).replace(/^/gm, '   '));
    const v = s.lead.voice;
    const why = v ? `${TIER_NAME[v.tier]}, ${v.affiliation}${v.stateAffiliated ? ', state-affiliated' : ''}` : 'not a tracked voice';
    lines.push(dim(`   why: ${why}; ${s.lead.why.amplifiedBy} voices amplified; ${s.posts.length - 1} related posts`));
    for (const d of s.disagreements) {
      if (d.type === 'pushback') {
        lines.push(magenta(`   ⚡ @${d.from.handle} (${d.from.voice.affiliation}) pushes back on @${d.to.handle} (${d.to.voice.affiliation})`));
      } else {
        const sides = d.sides.map((x) => `${x.value} per ${x.sources.join(', ')}`).join(' vs ');
        lines.push(magenta(`   ⚡ ${d.kind}: ${sides}`));
      }
    }
  });

  if (b.missingVoices.length) lines.push('', dim(`Voices not found on Bluesky (check handles): ${b.missingVoices.join(', ')}`));
  for (const e of b.errors) lines.push(dim(`warning: ${e}`));
  return lines.join('\n');
}
