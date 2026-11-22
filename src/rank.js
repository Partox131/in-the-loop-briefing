// Rank posts for "what's being talked about" by credible voices.
//
//   score = relevance × voice weight × log(1 + velocity / author's usual velocity)
//           × (1 + amplification by other voices) × 2^(-age / half-life)
//
// Velocity is engagement per hour. Dividing by the author's own usual
// velocity means a reporter with 5k followers getting 500 likes outranks a
// 2M-follower outlet getting 500 likes. See docs/design/topic-tracking.md 2.4.

import { engagement } from './digest.js?v=be3e94bf48';

/** Weight for accounts that are not in the voice registry (the open conversation). */
export const NON_VOICE_WEIGHT = 0.15;

/**
 * News articles have no likes or reposts of their own, so they rank as if
 * they had their author's usual engagement (log1p(1)). Bluesky posts sharing
 * the same article add their engagement to the storyline.
 */
export const NEWS_LIFT = Math.log1p(1);

const HOUR = 3_600_000;

export function velocity(post, now) {
  const ageH = Math.max((now - new Date(post.createdAt)) / HOUR, 0.25); // floor: 15 min
  return engagement(post) / ageH;
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * @param {Array} posts            normalised posts (with counts)
 * @param {object} o
 * @param {Map<string, import('./voices.js').Voice>} o.voices  by DID
 * @param {Date} [o.now]
 * @param {number} [o.halfLifeHours]
 * @param {Map<string, number>} [o.baselines]  did -> usual velocity; otherwise the median in this set
 * @param {Map<string, string[]>} [o.reposts]  post uri -> DIDs that reposted it (from Jetstream)
 */
export function rankPosts(posts, { voices = new Map(), now = new Date(), halfLifeHours = 6, baselines, reposts = new Map() } = {}) {
  const byAuthor = new Map();
  for (const p of posts) {
    if (!byAuthor.has(p.did)) byAuthor.set(p.did, []);
    byAuthor.get(p.did).push(velocity(p, now));
  }
  // Floor of 1 interaction/hour so a single quiet post doesn't explode the ratio.
  const baseline = (did) => Math.max(baselines?.get(did) ?? median(byAuthor.get(did) || []), 1);

  // Amplification: other voices quoting (seen in this set) or reposting a post.
  const amplifiers = new Map();
  const add = (uri, did) => {
    if (!voices.has(did)) return;
    if (!amplifiers.has(uri)) amplifiers.set(uri, new Set());
    amplifiers.get(uri).add(did);
  };
  for (const p of posts) if (p.quotedUri) add(p.quotedUri, p.did);
  for (const [uri, dids] of reposts) for (const d of dids) add(uri, d);

  return posts
    .map((p) => {
      const voice = voices.get(p.did);
      const weight = voice ? voice.weight * (voice.verified ? 1.1 : 1) : NON_VOICE_WEIGHT;
      const others = [...(amplifiers.get(p.uri) || [])].filter((d) => d !== p.did);
      const amplification = others.reduce((s, d) => s + voices.get(d).weight, 0);
      const ageH = Math.max((now - new Date(p.createdAt)) / HOUR, 0);
      const relevance = p.relevance ?? 1;
      // Small floor for voices so a brand-new report with no engagement yet still shows.
      const lift = p.source === 'news' ? NEWS_LIFT : Math.log1p(velocity(p, now) / baseline(p.did)) + (voice ? 0.1 : 0);
      const score = relevance * weight * lift * (1 + amplification) * 2 ** (-ageH / halfLifeHours);
      return { ...p, voice, score, why: { weight, lift, amplifiedBy: others.length, ageH } };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Apply a breadth quota: at most `perChild` items from each child topic and
 * `total` overall. Posts carry `node` (the deepest topic they matched).
 */
export function applyQuota(ranked, { perChild = Infinity, total = 15, childOf = (p) => p.node } = {}) {
  const used = new Map();
  const out = [];
  for (const p of ranked) {
    const k = childOf(p);
    if ((used.get(k) || 0) >= perChild) continue;
    used.set(k, (used.get(k) || 0) + 1);
    out.push(p);
    if (out.length >= total) break;
  }
  return out;
}
