// Group posts into storylines (one development each), give each a status,
// and flag possible disagreements between sources.
// See docs/design/topic-tracking.md, section 3.
//
// Grouping is rule-based, no AI: first shared article links and quote/reply
// chains, then matching headlines and wording (src/similar.js), so two
// outlets covering the same event corroborate each other without linking to
// each other. Embeddings and LLM claim extraction would plug in at
// `mergeSimilar`/`claimsOf` later.

import { mergeSimilar } from './similar.js?v=0e5f91b6d6';

const TRACKING_PARAMS = /^(utm_|fbclid|gclid|ref|smid|cmpid|at_|taid|ito|mc_)/i;

/** Normalise an article URL so the same story shared twice gets one key. */
export function canonicalUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.replace(/^(www|m|amp|mobile)\./, '');
    u.pathname = u.pathname.replace(/\/amp\/?$/, '/').replace(/\/$/, '');
    return u.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

class UnionFind {
  constructor() {
    this.parent = new Map();
  }
  find(x) {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let r = x;
    while (this.parent.get(r) !== r) r = this.parent.get(r);
    this.parent.set(x, r);
    return r;
  }
  union(a, b) {
    this.parent.set(this.find(a), this.find(b));
  }
}

// Numbers that war reporting most often disagrees on.
const CLAIM_NOUNS = {
  killed: 'killed', dead: 'killed', deaths: 'killed', casualties: 'killed',
  injured: 'injured', wounded: 'injured',
  missiles: 'missiles', 'ballistic missiles': 'missiles',
  drones: 'drones',
};
const CLAIM_RE = new RegExp(
  `(\\d[\\d,]*)\\s+(?:people\\s+|civilians\\s+|soldiers\\s+|were\\s+|have been\\s+)?(${Object.keys(CLAIM_NOUNS).join('|')})\\b`,
  'gi',
);

/** Extract simple numeric claims ("12 killed", "40 drones") from a post. */
export function claimsOf(text) {
  const out = [];
  for (const m of (text || '').matchAll(CLAIM_RE)) {
    out.push({ kind: CLAIM_NOUNS[m[2].toLowerCase()], value: Number(m[1].replace(/,/g, '')) });
  }
  return out;
}

/**
 * Status of a storyline from who is reporting it (design doc table 3.2):
 *   reported      one outlet/reporter, or claims only
 *   corroborated  two or more independent outlets/reporters (different affiliations)
 *   official      a named official account is a source
 *   disputed      sources disagree (set after disagreement detection)
 */
function statusOf(voicesInvolved) {
  const press = new Set(voicesInvolved.filter((v) => v.tier <= 2).map((v) => v.affiliation));
  const official = voicesInvolved.some((v) => v.tier === 4);
  if (press.size >= 2) return 'corroborated';
  if (official) return 'official';
  return 'reported';
}

/**
 * @param {Array} posts   ranked posts (from rankPosts), each optionally with `voice`
 * @param {object} [opts]
 * @param {boolean|object} [opts.textMatch=true]  also join storylines by similar
 *   wording; an object overrides the thresholds in MATCH_DEFAULTS
 * @returns {Array} storylines, best first
 */
export function buildStorylines(posts, { textMatch = true } = {}) {
  const uf = new UnionFind();
  const byUri = new Map(posts.map((p) => [p.uri, p]));
  const linkOwner = new Map();
  for (const p of posts) {
    uf.find(p.uri);
    for (const l of p.links || []) {
      const key = canonicalUrl(l);
      if (!key || key.includes('bsky.app/')) continue;
      if (linkOwner.has(key)) uf.union(p.uri, linkOwner.get(key));
      else linkOwner.set(key, p.uri);
    }
    for (const target of [p.quotedUri, p.replyParent]) if (target && byUri.has(target)) uf.union(p.uri, target);
  }

  const groups = new Map();
  for (const p of posts) {
    const root = uf.find(p.uri);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(p);
  }

  const merged = textMatch
    ? mergeSimilar([...groups.values()], textMatch === true ? {} : textMatch)
    : [...groups.values()].map((g) => ({ posts: g, matched: false }));

  const stories = [];
  for (const { posts: group, matched } of merged) {
    group.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const voicesInvolved = [...new Map(group.filter((p) => p.voice).map((p) => [p.did, p.voice])).values()];
    const times = group.map((p) => Date.parse(p.createdAt)).filter((t) => !Number.isNaN(t));
    const story = {
      lead: group[0],
      posts: group,
      voices: voicesInvolved,
      sources: [...new Set(voicesInvolved.map((v) => v.affiliation))],
      // affiliation -> country code, for state-affiliated sources (their flag is shown)
      flags: Object.fromEntries(voicesInvolved.filter((v) => v.country).map((v) => [v.affiliation, v.country])),
      regions: [...new Set(voicesInvolved.map((v) => v.region))],
      firstSeen: new Date(Math.min(...times)).toISOString(),
      lastSeen: new Date(Math.max(...times)).toISOString(),
      score: group.reduce((s, p) => s + (p.score ?? 0), 0),
      status: statusOf(voicesInvolved),
      disagreements: findDisagreements(group),
      // true when similar wording (not a shared link or quote) joined its posts
      matchedByText: matched,
    };
    if (story.disagreements.length) story.status = 'disputed';
    stories.push(story);
  }
  return stories.sort((a, b) => b.score - a.score);
}

// Casualty counts grow as bodies are found; other numbers (missiles, drones) don't.
const TOLLS = new Set(['killed', 'injured']);

const UPDATE_GAP_MS = 2 * 3_600_000;
const UPDATE_WORDS = /\b(?:toll|ris(?:e|es|en|ing)|rose|climb\w*|reach\w*|now|at least|up to)\b/i;

/**
 * True if the numbers only go up over time, like a death toll being updated:
 * no report is lower than an earlier one, and each higher number either says
 * it is an update ("toll rises to", "at least") or comes 2+ hours later.
 * Two outlets giving 12 and 30 an hour apart still disagree.
 */
function rising(reports) {
  const sorted = [...reports].sort((a, b) => a.at - b.at);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const [a, b] = [sorted[i], sorted[j]];
      if (b.value < a.value) return false;
      if (b.value > a.value && !b.update && b.at - a.at < UPDATE_GAP_MS) return false;
    }
  }
  return true;
}

/**
 * Two cheap signals (the design doc lists two more for later):
 *  - a voice quoting or replying to a voice from a different outlet
 *    ("pushback": a candidate, to be confirmed by an LLM stance check)
 *  - different numbers for the same thing from different outlets
 */
export function findDisagreements(group) {
  const out = [];
  const byUri = new Map(group.map((p) => [p.uri, p]));
  for (const p of group) {
    const target = byUri.get(p.quotedUri) || byUri.get(p.replyParent);
    if (p.voice && target?.voice && p.voice.affiliation !== target.voice.affiliation) {
      out.push({ type: 'pushback', from: p, to: target });
    }
  }
  const claims = new Map(); // kind -> Map(value -> Set(affiliation))
  const examples = new Map();
  const reports = new Map(); // kind -> [{ value, at }]
  for (const p of group) {
    if (!p.voice) continue;
    for (const c of claimsOf(p.text)) {
      if (!claims.has(c.kind)) claims.set(c.kind, new Map());
      const m = claims.get(c.kind);
      if (!m.has(c.value)) m.set(c.value, new Set());
      m.get(c.value).add(p.voice.affiliation);
      examples.set(`${c.kind}:${c.value}`, p);
      if (!reports.has(c.kind)) reports.set(c.kind, []);
      reports.get(c.kind).push({ value: c.value, at: Date.parse(p.createdAt) || 0, update: UPDATE_WORDS.test(p.text || '') });
    }
  }
  for (const [kind, values] of claims) {
    if (values.size < 2) continue;
    // One outlet updating its own number is not a disagreement.
    if (new Set([...values.values()].flatMap((x) => [...x])).size < 2) continue;
    // Nor is a toll that only goes up over time ("rises to 11", then "15 killed").
    if (TOLLS.has(kind) && rising(reports.get(kind))) continue;
    const sides = [...values.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([value, sources]) => ({ value, sources: [...sources], post: examples.get(`${kind}:${value}`) }));
    out.push({ type: 'numbers', kind, sides });
  }
  return out;
}
