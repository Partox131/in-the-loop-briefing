// Wire copy: one story, reprinted by several outlets, is one source.
//
// Outlets run news agency copy under their own name: CBS, ABC and PBS carry
// the same AP story; France 24 and Arab News carry AFP's. Counted by outlet,
// one agency report looks like several independent sources, which is enough
// to make a storyline "Confirmed", Breaking (2 sources in 30 minutes) or Hot.
// Idea from World Monitor's syndication check (github.com/koala73/worldmonitor,
// docs and scripts/shared/syndication.js), written here from its description,
// not copied (their code is AGPL).
//
// Two rules, both only ever lower the count:
//   1. Byline: an item whose text says "(AP) —", "(Reuters) -", "(AFP) -" or
//      whose headline ends "- Reuters" counts as that agency.
//   2. Same text: two items in one storyline whose leads (the text after the
//      headline) are nearly the same, at least 85% of the shorter lead's
//      three-word runs found in the other, count as one copy. An article's lead
//      needs 12+ words; a social post, whose text is often just a headline,
//      needs 25+. Two outlets can write the same short headline on their own.
// A copy counts as the agency when any copy names it, else as the outlet that
// published it first.
//
// Browser-safe: no Node imports.

export const COPY_RULES = { minLeadWords: 12, minPostWords: 25, containment: 0.85, leadWords: 60 };

/** News agencies by the names their bylines use, mapped to our `affiliation`. */
export const WIRES = { AP: 'Associated Press', 'ASSOCIATED PRESS': 'Associated Press', REUTERS: 'Reuters', AFP: 'AFP' };

const WIRE_NAMES = '(AP|Associated Press|Reuters|AFP)';
// "WASHINGTON (AP) — ", "(Reuters) - ", "KYIV, Ukraine (AP) —" near the start of the text.
const DATELINE_RE = new RegExp(`^[^()]{0,60}\\(${WIRE_NAMES}\\)\\s*[—–-]`, 'i');
// "… - Reuters", "… | AP News", "… (AFP)" at the end of a headline.
const SUFFIX_RE = new RegExp(`(?:\\s[-|–—]\\s*${WIRE_NAMES}(?: News)?|\\s\\(${WIRE_NAMES}\\))\\s*$`, 'i');

/** The text after an item's headline (an article's summary, or a post's own text). */
export function leadOf(p) {
  const text = String(p?.text || '');
  if (p?.source === 'news' && p.title && text.startsWith(p.title)) return text.slice(p.title.length).replace(/^[.\s]+/, '');
  return text;
}

/** The news agency an item's byline names (our affiliation for it), or null. */
export function wireOf(p) {
  const name = (m) => (m ? WIRES[m.toUpperCase()] : null);
  const head = String(p?.title || p?.linkTitle || '');
  const lead = leadOf(p);
  const d = DATELINE_RE.exec(lead) || DATELINE_RE.exec(String(p?.text || ''));
  if (d) return name(d[1]);
  const s = SUFFIX_RE.exec(head);
  return s ? name(s[1] || s[2]) : null;
}

function words(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Three-word runs of an item's lead, or null when the lead is too short to tell. */
export function shinglesOf(p, rules = COPY_RULES) {
  const all = words(leadOf(p));
  if (all.length < (p?.source === 'news' ? rules.minLeadWords : rules.minPostWords)) return null;
  const w = all.slice(0, rules.leadWords);
  const out = new Set();
  for (let i = 2; i < w.length; i++) out.add(`${w[i - 2]} ${w[i - 1]} ${w[i]}`);
  return out;
}

/** Share of the smaller set found in the larger one (feeds cut the same lead at different lengths). */
export function containment(a, b) {
  if (a.size > b.size) [a, b] = [b, a];
  if (!a.size) return 0;
  let n = 0;
  for (const k of a) if (b.has(k)) n++;
  return n / a.size;
}

// item -> the source its copy counts as (only for items that are one of several copies)
const copyKeys = new WeakMap();

/** The source an item counts as because it is a copy of another item's story, or undefined. */
export function copyKeyOf(p) {
  return p && typeof p === 'object' ? copyKeys.get(p) : undefined;
}

/**
 * Find copies among one storyline's items and remember, for each, the source
 * it counts as (read back by `copyKeyOf`, which src/credibility.js roleOf uses).
 * @param {Array} posts      the storyline's items
 * @param {Function} sourceOf item -> its own source key, or null if it can't confirm anything
 * @returns {number} how many items count as someone else's copy
 */
export function markCopies(posts, sourceOf, rules = COPY_RULES) {
  const items = posts
    .map((p) => ({ p, key: sourceOf(p), sh: shinglesOf(p, rules), at: Date.parse(p.createdAt) || 0 }))
    .filter((x) => x.key);
  const parent = items.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++) {
    if (!items[i].sh) continue;
    for (let j = i + 1; j < items.length; j++) {
      if (!items[j].sh || items[i].key === items[j].key) continue;
      if (containment(items[i].sh, items[j].sh) >= rules.containment) parent[find(j)] = find(i);
    }
  }
  const groups = new Map();
  items.forEach((x, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(x);
  });
  let n = 0;
  for (const x of items) {
    const wire = wireOf(x.p);
    if (wire && wire !== x.key) {
      copyKeys.set(x.p, wire);
      n++;
    }
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const wire = g.map((x) => wireOf(x.p)).find(Boolean);
    const first = [...g].sort((a, b) => a.at - b.at)[0];
    const key = wire || first.key;
    for (const x of g) {
      if (x.key === key) {
        copyKeys.delete(x.p);
        continue;
      }
      if (!copyKeys.has(x.p)) n++;
      copyKeys.set(x.p, key);
    }
  }
  return n;
}
