// A "topic" is what a user wants to stay in the loop on: a set of keywords,
// phrases and hashtags to include, optional ones to exclude, and optional
// language filters. The same matcher is used for search results and for the
// live Jetstream feed, so both paths agree on what counts as "on topic".

/**
 * @typedef {Object} Topic
 * @property {string} id
 * @property {string} label
 * @property {string[]} include  keywords, "multi word phrases" or #hashtags
 * @property {string[]} exclude
 * @property {string[]} langs    BCP-47 language prefixes, e.g. ["en"]; empty = any
 * @property {string[]} require  optional context terms: if set, a post must ALSO
 *                               match one of these (e.g. "Iran" AND "strike")
 */

/** Build a topic from loose input, normalising and validating fields. */
export function makeTopic({ id, label, include = [], exclude = [], langs = [], require = [] }) {
  const clean = (xs) => [...new Set(xs.map((s) => String(s).trim()).filter(Boolean))];
  const inc = clean(include);
  if (inc.length === 0) throw new Error('A topic needs at least one include term.');
  return {
    id: id || slug(inc[0]),
    label: label || inc.join(', '),
    include: inc,
    exclude: clean(exclude),
    langs: clean(langs).map((l) => l.toLowerCase()),
    require: clean(require),
  };
}

function slug(s) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile a term into a predicate over (lowercased text, set of lowercased tags).
 * - "#tag"   matches the hashtag facet/tag list, or "#tag" in the text.
 * - "phrase" matches on word boundaries, case-insensitive, whitespace-tolerant
 *   (substring match for Chinese/Japanese/Thai, which don't separate words).
 */
export function compileTerm(term) {
  const t = term.toLowerCase();
  if (t.startsWith('#')) {
    const tag = t.slice(1);
    const re = new RegExp(`(^|[^\\p{L}\\p{N}_])#${escapeRe(tag)}(?![\\p{L}\\p{N}_])`, 'u');
    return (text, tags) => tags.has(tag) || re.test(text);
  }
  // Scripts written without spaces between words: plain substring match.
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(t)) {
    return (text) => text.includes(t);
  }
  const body = t.split(/\s+/).map(escapeRe).join('\\s+');
  const re = new RegExp(`(^|[^\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'u');
  return (text) => re.test(text);
}

/**
 * Returns a function (post) => { matched: boolean, terms: string[] }.
 * `post` is a normalised post (see normalize.js): { text, tags, langs }.
 */
export function compileMatcher(topic) {
  const inc = topic.include.map((term) => ({ term, test: compileTerm(term) }));
  const exc = topic.exclude.map(compileTerm);
  const req = (topic.require || []).map(compileTerm);
  const langs = topic.langs;

  return (post) => {
    if (langs.length && post.langs?.length) {
      const ok = post.langs.some((l) => langs.some((want) => l.toLowerCase().startsWith(want)));
      if (!ok) return { matched: false, terms: [] };
    }
    const text = (post.text || '').toLowerCase();
    const tags = new Set((post.tags || []).map((t) => t.toLowerCase()));
    if (exc.some((test) => test(text, tags))) return { matched: false, terms: [] };
    if (req.length && !req.some((test) => test(text, tags))) return { matched: false, terms: [] };
    const terms = inc.filter(({ test }) => test(text, tags)).map(({ term }) => term);
    return { matched: terms.length > 0, terms };
  };
}
