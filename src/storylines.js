// Group posts into storylines (one development each), give each a status,
// and flag possible disagreements between sources.
// See docs/design/topic-tracking.md, section 3.
//
// Grouping is rule-based, no AI: first shared article links and quote/reply
// chains, then matching headlines and wording (src/similar.js), so two
// outlets covering the same event corroborate each other without linking to
// each other. Embeddings and LLM claim extraction would plug in at
// `mergeSimilar`/`claimsOf` later.

import { mergeSimilar } from './similar.js?v=8159273ad1';
import { roleOf } from './credibility.js?v=8159273ad1';
import { markCopies } from './copies.js?v=8159273ad1';

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
 * Status of a storyline from who is reporting it (source credibility plan,
 * docs/design/source-credibility.md, Amir 26 Nov 2026):
 *   claimed       only a side in the story's conflict says it: its own media or
 *                 officials, or outlets writing "Iran says…"
 *   reported      one independent source reporting it in its own voice
 *   corroborated  ("Confirmed") two independent sources, or a side's claim plus
 *                 one independent source
 *   official      a named official account with no side in it is the source
 *   disputed      sources disagree (set after disagreement detection)
 * State media from one country count as one source; outside a conflict every
 * source reports in its own voice, as before.
 */
export function statusOf(posts, conflict) {
  const witnesses = new Set();
  const claims = new Set();
  for (const p of posts) {
    const r = roleOf(p, conflict);
    if (r.claim) claims.add(r.claim);
    else if (r.witness && p.voice?.tier !== 4) witnesses.add(r.witness);
  }
  const official = posts.some((p) => p.voice?.tier === 4 && !roleOf(p, conflict).claim);
  let status = 'reported';
  if (witnesses.size >= 2 || (witnesses.size >= 1 && claims.size >= 1)) status = 'corroborated';
  else if (witnesses.size === 1) status = 'reported';
  else if (claims.size) status = 'claimed';
  else if (official) status = 'official';
  return { status, claimedBy: [...claims], witnesses: witnesses.size };
}

/**
 * What each side says and who was first (source credibility plan, part 3):
 *   sides         one entry per side with a claim: its latest item
 *   firstClaim    the earliest item that is a side's claim
 *   firstWitness  the earliest item from an independent source
 * Times are ISO strings; `by` is the source's name.
 */
export function sidesOf(posts, conflict) {
  const item = (p, side) => ({ side, at: p.createdAt, by: p.voice?.name || p.handle, text: p.text, url: p.url });
  const byTime = [...posts].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const latest = new Map();
  let firstClaim, firstWitness;
  for (const p of byTime) {
    const r = roleOf(p, conflict);
    if (r.claim) {
      latest.set(r.claim, item(p, r.claim));
      firstClaim ??= item(p, r.claim);
    } else if (r.witness && p.voice?.tier !== 4) firstWitness ??= item(p);
  }
  return { sides: [...latest.values()], firstClaim, firstWitness };
}

/**
 * The key moments of a storyline, oldest first, worked out from its posts
 * (source credibility plan, part 4). The server keeps these, so a timeline
 * outlives the 48 hours of posts the snapshot holds.
 *   first    the earliest report
 *   claim    each source's first claim for a side, and its later ones 3+ hours apart
 *   witness  the first report from each independent source (up to 3)
 *   status   the status changing as reports came in (claimed -> corroborated...)
 * Each has a `key` that stays the same between runs, so it is stored once.
 */
export const CLAIM_UPDATE_MS = 3 * 3_600_000;
export function timelineOf(posts, conflict) {
  const byTime = [...posts]
    .filter((p) => !Number.isNaN(Date.parse(p.createdAt)))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const item = (p) => ({
    at: new Date(Date.parse(p.createdAt)).toISOString(),
    by: p.voice?.affiliation || p.voice?.name || p.displayName || p.handle,
    text: String(p.text || '').replace(/\s+/g, ' ').trim().slice(0, 240),
    url: p.url,
    uri: p.uri,
    ...(p.telegram ? { telegram: true } : {}),
  });
  const out = [];
  const witnesses = new Set();
  const claims = new Set();
  const lastClaim = new Map();
  let official = false;
  let status = null;
  for (const p of byTime) {
    if (!out.length) out.push({ key: 'first', kind: 'first', ...item(p) });
    const r = roleOf(p, conflict);
    const at = Date.parse(p.createdAt);
    if (r.claim) {
      // per source, so each one's track record counts (scripts/stories.js records)
      const who = `${r.claim}|${item(p).by}`;
      const last = lastClaim.get(who);
      if (last === undefined || at - last >= CLAIM_UPDATE_MS) {
        out.push({ key: `claim:${r.claim}:${p.uri}`, kind: 'claim', side: r.claim, ...item(p) });
        lastClaim.set(who, at);
      }
      claims.add(r.claim);
    } else if (r.witness && p.voice?.tier !== 4) {
      if (!witnesses.has(r.witness) && witnesses.size < 3) out.push({ key: `witness:${r.witness}`, kind: 'witness', ...item(p) });
      witnesses.add(r.witness);
    } else if (p.voice?.tier === 4) official = true;
    let next = 'reported';
    if (witnesses.size >= 2 || (witnesses.size >= 1 && claims.size >= 1)) next = 'corroborated';
    else if (witnesses.size === 1) next = 'reported';
    else if (claims.size) next = 'claimed';
    else if (official) next = 'official';
    if (next !== status) {
      out.push({ key: `status:${next}`, kind: 'status', from: status, to: next, ...item(p) });
      status = next;
    }
  }
  return out;
}

/** The conflict most of a storyline's posts are about (posts carry `conflict`). */
function conflictOf(posts) {
  const n = new Map();
  for (const p of posts) if (p.conflict) n.set(p.conflict, (n.get(p.conflict) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
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
    // Reprints of one agency story count as one source from here on.
    const copies = markCopies(group, (p) => roleOf(p, conflictOf(group), { copies: false }).witness);
    const voicesInvolved = [...new Map(group.filter((p) => p.voice).map((p) => [p.did, p.voice])).values()];
    const times = group.map((p) => Date.parse(p.createdAt)).filter((t) => !Number.isNaN(t));
    const story = {
      lead: group[0],
      posts: group,
      voices: voicesInvolved,
      sources: [...new Set(voicesInvolved.map((v) => v.affiliation))],
      // affiliation -> country code, for state-affiliated sources (their flag is shown)
      flags: Object.fromEntries(voicesInvolved.filter((v) => v.country).map((v) => [v.affiliation, v.country])),
      // affiliation -> credibility tag ({ short, note }) for sources that are not independent
      creds: Object.fromEntries(voicesInvolved.filter((v) => v.cred).map((v) => [v.affiliation, v.cred])),
      regions: [...new Set(voicesInvolved.map((v) => v.region))],
      firstSeen: new Date(Math.min(...times)).toISOString(),
      lastSeen: new Date(Math.max(...times)).toISOString(),
      score: group.reduce((s, p) => s + (p.score ?? 0), 0),
      ...statusOf(group, conflictOf(group)),
      conflict: conflictOf(group),
      ...sidesOf(group, conflictOf(group)),
      disagreements: findDisagreements(group),
      // true when similar wording (not a shared link or quote) joined its posts
      matchedByText: matched,
      // items that count as another source's copy (agency reprints)
      ...(copies ? { copies } : {}),
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
