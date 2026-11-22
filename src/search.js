// Pull recent posts for a topic from Bluesky's search API.
//
// We run one search per include term (search has no reliable OR operator),
// merge and de-duplicate by URI, then re-apply our own matcher so that
// excludes, language filters and word-boundary rules match the live path.

import { compileMatcher } from './topic.js?v=12d6f5a75c';

export function termToQuery(term) {
  if (term.startsWith('#')) return term; // hashtag search
  return /\s/.test(term) ? `"${term}"` : term; // exact phrase
}

/**
 * @param {import('./bsky.js').BskyClient} client
 * @param {import('./topic.js').Topic} topic
 * @param {{since?: Date, maxPerTerm?: number, sort?: 'latest'|'top'}} opts
 */
export async function searchTopic(client, topic, { since, maxPerTerm = 100, sort = 'latest' } = {}) {
  const match = topic.match ?? compileMatcher(topic);
  const lang = topic.langs.length === 1 ? topic.langs[0] : undefined;
  const byUri = new Map();
  const errors = [];

  for (const term of topic.include) {
    try {
      const posts = await client.searchPosts({
        q: termToQuery(term),
        sort,
        since: since?.toISOString(),
        lang,
        max: maxPerTerm,
      });
      for (const p of posts) {
        if (byUri.has(p.uri)) continue;
        const m = match(p);
        if (m.matched) byUri.set(p.uri, { ...p, matchedTerms: m.terms });
      }
    } catch (err) {
      errors.push({ term, error: err.message });
    }
  }
  if (errors.length === topic.include.length) {
    throw new Error(`All searches failed. First error: ${errors[0].error}`);
  }
  const posts = [...byUri.values()]
    .filter((p) => !since || new Date(p.createdAt) >= since)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return { posts, errors };
}
