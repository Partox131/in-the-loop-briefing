// Turn a pile of matching posts into a quick "what's going on" digest.
// Deliberately simple (counts and rankings, no LLM) so it's cheap and
// deterministic; it's the input a later summarisation step would build on.

const STOPWORDS = new Set(
  `a about above after again against all am an and any are as at be because been before being below between both but by
  can could did do does doing down during each few for from further had has have having he her here hers herself him
  himself his how i if in into is it its itself just let me more most my myself no nor not now of off on once only or
  other our ours ourselves out over own same she should so some such than that the their theirs them themselves then
  there these they this those through to too under until up very was we were what when where which while who whom why
  will with would you your yours yourself yourselves im ive dont doesnt didnt isnt its thats theres youre theyre
  cant wont also get got like one really still even much going new via amp https http www com rt
  de la el en es le les des du un une et que por para con los las und der die das ist`.split(/\s+/),
);

export function engagement(p) {
  if (!p.counts) return 0;
  const { likes, reposts, replies, quotes } = p.counts;
  return likes + 2 * reposts + 2 * quotes + replies;
}

function topN(counter, n) {
  return [...counter.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function inc(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

// Hourly buckets from first to last hour, including empty hours.
function fillHours(perHour) {
  const keys = [...perHour.keys()].sort();
  if (!keys.length) return [];
  const out = [];
  for (let t = Date.parse(keys[0]); t <= Date.parse(keys.at(-1)); t += 3_600_000) {
    const k = new Date(t).toISOString();
    out.push([k, perHour.get(k) || 0]);
  }
  return out;
}

/**
 * @param {Array} posts normalised posts (see normalize.js)
 * @param {import('./topic.js').Topic} topic
 * @param {{top?: number, now?: Date}} opts
 */
export function buildDigest(posts, topic, { top = 5, now = new Date() } = {}) {
  const topicWords = new Set(
    topic.include.flatMap((t) => t.toLowerCase().replace(/^#/, '').split(/\s+/)),
  );
  const topicTags = new Set(topic.include.filter((t) => t.startsWith('#')).map((t) => t.slice(1).toLowerCase()));

  const tags = new Map();
  const words = new Map();
  const domains = new Map();
  const authors = new Map();
  const terms = new Map();
  const quoted = new Map();
  const perHour = new Map();
  let replies = 0;

  for (const p of posts) {
    for (const t of new Set(p.tags.map((x) => x.toLowerCase()))) if (!topicTags.has(t)) inc(tags, `#${t}`);
    for (const l of p.links) {
      const d = domainOf(l);
      if (d && d !== 'bsky.app') inc(domains, d);
    }
    for (const t of p.matchedTerms || []) inc(terms, t);
    if (p.quotedUri) inc(quoted, p.quotedUri);
    if (p.isReply) replies++;
    inc(authors, p.handle || p.did);
    const hour = new Date(p.createdAt);
    if (!Number.isNaN(hour.getTime())) {
      hour.setUTCMinutes(0, 0, 0);
      inc(perHour, hour.toISOString());
    }
    const seen = new Set();
    for (const w of p.text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]{2,}/gu) || []) {
      const word = w.replace(/['’]s$/, '');
      if (STOPWORDS.has(word) || topicWords.has(word) || /^\d+$/.test(word) || seen.has(word)) continue;
      seen.add(word);
      inc(words, word);
    }
  }

  const times = posts.map((p) => new Date(p.createdAt).getTime()).filter((t) => !Number.isNaN(t));
  const oldest = times.length ? new Date(Math.min(...times)) : undefined;
  const hours = oldest ? Math.max((now - oldest) / 3_600_000, 1 / 60) : 0;

  const byEngagement = posts.filter((p) => p.counts).sort((a, b) => engagement(b) - engagement(a));

  return {
    topic: topic.label,
    total: posts.length,
    replies,
    originals: posts.length - replies,
    uniqueAuthors: authors.size,
    from: oldest?.toISOString(),
    to: times.length ? new Date(Math.max(...times)).toISOString() : undefined,
    postsPerHour: hours ? posts.length / hours : 0,
    perHour: fillHours(perHour),
    matchedTerms: topN(terms, top * 2),
    topTags: topN(tags, top),
    topWords: topN(words, top * 2),
    topDomains: topN(domains, top),
    topAuthors: topN(authors, top),
    mostQuoted: topN(quoted, 3).filter(([, n]) => n > 1),
    topPosts: byEngagement.slice(0, top),
  };
}
