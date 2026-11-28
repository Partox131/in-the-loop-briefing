// Match posts and articles about the same event when they share no link.
//
// Outlets rarely link to each other, so storylines built from shared links
// and quote chains leave most stories "reported once". This adds a cheap,
// rule-based text match (no AI, no server): each post becomes a bag of
// distinctive words and word pairs, weighted by how rare they are in the
// current batch (TF-IDF), and two groups join when they were published close
// together and their wording is similar enough.
//
// Guarding against over-merging matters more than catching every match:
//   - words every post in the batch uses ("Iran", "war", "says") weigh little
//   - a match needs several shared distinctive words, not one
//   - groups join a storyline's combined wording (its centroid), not a
//     single member, so A~B and B~C don't chain A to an unrelated C
//   - only within a time window (an event is reported within hours)
//
// Embeddings would replace `vectorOf` later; the clustering stays the same.
//
// Browser-safe: no Node imports.

const STOP = new Set(
  (
    'a about above after again against all also am amid an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours ' +
    // News boilerplate that says nothing about the event.
    'says said say saying told tells report reports reported reporting according news live latest update updates breaking video watch read via new day days week weeks year years today yesterday tonight morning evening week first last one two three people time times may might must per still back could get got make made take takes took amid among around across near since ago us mr ms dr'
  ).split(/\s+/),
);

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

/** Crude English stemmer: enough to match "strikes"/"strike", "killed"/"kills". */
function stem(w) {
  if (w.length <= 4 || /\d/.test(w)) return w;
  return w
    .replace(/['’]s$/, '')
    .replace(/(ies)$/, 'y')
    .replace(/(sses)$/, 'ss')
    .replace(/([^s])s$/, '$1')
    .replace(/(ing|ed)$/, (m, _s, i, str) => (str.length - m.length >= 4 ? '' : m));
}

// "Iranian" and "Iran", "Russia's" and "Russian" name the same side: fold
// the demonyms of the places we cover into the country, so one outlet's
// "Iranian drone" matches another's "Iran drone".
const DEMONYMS = {
  iranian: 'iran', israeli: 'israel', russian: 'russia', ukrainian: 'ukraine', chinese: 'china',
  taiwanese: 'taiwan', american: 'america', lebanese: 'lebanon', syrian: 'syria', iraqi: 'iraq',
  yemeni: 'yemen', palestinian: 'palestine', saudi: 'saudi', qatari: 'qatar', emirati: 'uae',
  turkish: 'turkey', polish: 'poland', belarusian: 'belarus', korean: 'korea', japanese: 'japan',
  canadian: 'canada', british: 'britain', french: 'france', german: 'germany', european: 'europe',
};

// How much more a name or a number counts than an ordinary word (World
// Monitor's story matching does the same): "Turkey raises rates to 50%" and
// "Argentina raises rates to 50%" share most words, but not the country.
export const BOOST = { name: 3, number: 2 };

/**
 * Content words of a text, in order, each with how much it counts: a word
 * capitalised mid-sentence (a name) or a number counts more. In a headline
 * written In Title Case every word is capitalised, so nothing is boosted.
 */
function tokensOf(text) {
  const raw = String(text || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#@]/g, ' ');
  const found = [...raw.matchAll(WORD_RE)];
  const caps = found.filter((m) => /^\p{Lu}/u.test(m[0])).length;
  const titleCase = found.length >= 4 && caps / found.length > 0.6;
  const out = [];
  for (const m of found) {
    let w = m[0].toLowerCase().replace(/['’-]+$/, '');
    if (w.length < 3 && !/\d/.test(w)) continue;
    if (STOP.has(w)) continue;
    // Years and tiny numbers are everywhere; bigger numbers ("12 killed") are useful.
    if (/^\d+$/.test(w) && (Number(w) < 3 || /^20\d\d$/.test(w))) continue;
    w = w.replace(/['’]s$/, '');
    w = DEMONYMS[w] || DEMONYMS[w.replace(/s$/, '')] || stem(w);
    const before = raw.slice(0, m.index).trimEnd();
    const sentenceStart = !before || /[.!?:;\n"“]$/.test(before);
    const boost = /\d/.test(w) ? BOOST.number : !titleCase && !sentenceStart && /^\p{Lu}/u.test(m[0]) ? BOOST.name : 1;
    out.push({ w, boost });
  }
  return out;
}

/** Content words of a text, in order, lower-cased and stemmed. */
export function wordsOf(text) {
  return tokensOf(text).map((t) => t.w);
}

// "… - Reuters", "… | AP News", "… - The Times of Israel": the outlet's name
// after a headline says who published it, not what happened.
const WIRE_SUFFIX = /\s+[-|–—]\s*(?:AP News|AP|Associated Press|Reuters|AFP)\s*$/i;

/** A headline without the outlet's own name tacked on the end. */
export function stripOutletSuffix(head, name) {
  let h = String(head || '').replace(WIRE_SUFFIX, '');
  if (name) {
    const esc = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/^the\s+/i, '');
    h = h.replace(new RegExp(`\\s+[-|–—]\\s*(?:the\\s+)?${esc}(?:\\s+news)?\\s*$`, 'i'), '');
  }
  return h;
}

/**
 * The text that describes what a post is about: an article's headline (and
 * the start of its summary), or a post's text plus the headline of the
 * article it links to.
 */
export function aboutText(p) {
  if (p.source === 'news') {
    const summary = p.title && p.text?.startsWith(p.title) ? p.text.slice(p.title.length) : '';
    return { head: stripOutletSuffix(p.title || p.text || '', p.displayName), body: summary.slice(0, 240) };
  }
  return { head: stripOutletSuffix(p.linkTitle || ''), body: String(p.text || '').slice(0, 300) };
}

/** Words and word pairs of a post's headline (or the start of its text). */
function headTermsOf(p) {
  const { head, body } = aboutText(p);
  const words = wordsOf(head || body.slice(0, 140));
  const out = new Set(words);
  words.forEach((w, i) => i > 0 && out.add(`${words[i - 1]} ${w}`));
  return out;
}

/**
 * The names in a post's headline (words capitalised mid-sentence, so none in
 * a headline written In Title Case), and every word of the post.
 */
function namesOf(p) {
  const { head, body } = aboutText(p);
  const names = new Set(tokensOf(head || body.slice(0, 140)).filter((t) => t.boost === BOOST.name).map((t) => t.w));
  const words = new Set([...wordsOf(head), ...wordsOf(body)]);
  return { names, words };
}

/**
 * Two reports name different places or people in their headlines: each names
 * someone or somewhere the other never mentions ("strike on Zaporizhzhia" and
 * "strike on Kryvyi Rih" the same night are two events). Only names the other
 * side doesn't mention at all count, so "Beirut" vs "Lebanon" doesn't block
 * when the Beirut report also says "Lebanese".
 */
export function namesConflict(a, b) {
  const extra = (x, y) => [...x.names].some((n) => !y.words.has(n));
  return extra(a, b) && extra(b, a);
}

/** Term counts for a post: words and adjacent word pairs, the headline counting double. */
function termsOf(p) {
  const counts = new Map();
  counts.names = new Set(); // names and numbers: kept even when no other post uses them
  const add = (tokens, weight) => {
    tokens.forEach(({ w, boost }, i) => {
      if (boost > 1) counts.names.add(w);
      // Names and numbers count more on their own; word pairs keep one weight.
      counts.set(w, (counts.get(w) || 0) + weight * boost);
      if (i > 0) counts.set(`${tokens[i - 1].w} ${w}`, (counts.get(`${tokens[i - 1].w} ${w}`) || 0) + weight);
    });
  };
  const { head, body } = aboutText(p);
  add(tokensOf(head), 2);
  add(tokensOf(body), 1);
  return counts;
}

function norm(v) {
  let s = 0;
  for (const x of v.values()) s += x * x;
  return Math.sqrt(s);
}

function cosine(a, b) {
  if (a.size > b.size) [a, b] = [b, a];
  let dot = 0;
  for (const [k, x] of a) {
    const y = b.get(k);
    if (y) dot += x * y;
  }
  const n = norm(a) * norm(b);
  return n ? dot / n : 0;
}

/**
 * TF-IDF vectors for a batch of posts.
 *  - A term in more than `maxShare` of the posts (the topic's own name) is dropped.
 *  - A term an author uses in most of their own posts (their name, a
 *    newsletter tagline, "focustaiwan.tw") is dropped for that author.
 * Each vector also lists its rare terms (in at most `rareShare` of posts):
 * the names, places and details that actually identify an event, and which
 * of those are in its headline.
 */
export function vectorize(posts, { maxShare = 0.12, rareShare = 0.03 } = {}) {
  const terms = posts.map(termsOf);
  const df = new Map();
  for (const t of terms) for (const k of t.keys()) df.set(k, (df.get(k) || 0) + 1);
  const byAuthor = new Map();
  posts.forEach((p, i) => {
    if (!byAuthor.has(p.did)) byAuthor.set(p.did, []);
    byAuthor.get(p.did).push(i);
  });
  const habit = new Map(); // did -> Set of terms that author over-uses
  for (const [did, idx] of byAuthor) {
    if (idx.length < 4) continue;
    const c = new Map();
    for (const i of idx) for (const k of terms[i].keys()) c.set(k, (c.get(k) || 0) + 1);
    habit.set(did, new Set([...c].filter(([, x]) => x >= Math.max(3, idx.length * 0.3)).map(([k]) => k)));
  }
  const n = posts.length;
  const cap = Math.max(3, n * maxShare);
  const rare = Math.max(2, n * rareShare);
  return terms.map((t, i) => {
    const v = new Map();
    v.rare = new Set();
    v.head = new Set();
    const own = habit.get(posts[i].did);
    const head = headTermsOf(posts[i]);
    for (const [k, c] of t) {
      const d = df.get(k);
      // A word nobody else uses can't link anything, but a name or number only
      // this post has still sets it apart ("Turkey" vs "Argentina raises rates").
      const only = d < 2 && n > 3;
      if (only && !t.names.has(k)) continue;
      if (d > cap || own?.has(k)) continue;
      const idf = Math.log((n + 1) / d);
      // Pairs ("drone strike", "kharkiv region") are stronger evidence than single words.
      v.set(k, Math.sqrt(c) * idf * (k.includes(' ') ? 1.5 : 1));
      if (d <= rare && !only) {
        v.rare.add(k);
        if (head.has(k)) v.head.add(k);
      }
    }
    return v;
  });
}

function addInto(sum, v) {
  const n = norm(v) || 1;
  for (const [k, x] of v) sum.set(k, (sum.get(k) || 0) + x / n);
}

/**
 * How many rare details two sets share. A shared word pair counts once and
 * its two words don't count again, so "South Korea" alone is one detail.
 */
export function sharedDetails(a, b) {
  if (a.size > b.size) [a, b] = [b, a];
  const both = [...a].filter((k) => b.has(k));
  const pairs = both.filter((k) => k.includes(' '));
  const inPair = new Set(pairs.flatMap((k) => k.split(' ')));
  return pairs.length + both.filter((k) => !k.includes(' ') && !inPair.has(k)).length;
}

function overlaps(a, b) {
  for (const k of a) if (b.has(k)) return true;
  return false;
}

export const MATCH_DEFAULTS = {
  threshold: 0.3, // cosine between a group and a storyline's combined wording
  sameSourceThreshold: 0.5, // stricter when only one outlet is involved on both sides
  minShared: 2, // rare details in common with one member of the storyline
  windowHours: 18, // how far apart in time two reports of one event can be
};

/**
 * Join groups of posts (already linked by shared links or quotes) whose
 * wording matches. Greedy, oldest group first: each group joins the existing
 * storyline it is most similar to, if any passes the bar.
 *
 * @param {Array<Array>} groups  arrays of posts
 * @returns {Array<{ posts: Array, matched: boolean }>} merged groups;
 *   `matched` is true when text matching joined more than one group
 */
export function mergeSimilar(groups, opts = {}) {
  const { threshold, sameSourceThreshold, minShared, windowHours } = { ...MATCH_DEFAULTS, ...opts };
  const all = groups.flat();
  const vecs = vectorize(all, opts);
  const vecOf = new Map(all.map((p, i) => [p, vecs[i]]));
  const timeOf = (p) => Date.parse(p.createdAt) || 0;

  const sourceOf = (p) => p.voice?.affiliation || p.did;
  const items = groups.map((posts) => {
    const v = new Map();
    const rare = new Set();
    const head = new Set();
    for (const p of posts) {
      const pv = vecOf.get(p);
      addInto(v, pv);
      for (const k of pv.rare) rare.add(k);
      for (const k of pv.head) head.add(k);
    }
    const times = posts.map(timeOf);
    const named = { names: new Set(), words: new Set() };
    for (const p of posts) {
      const n = namesOf(p);
      for (const k of n.names) named.names.add(k);
      for (const k of n.words) named.words.add(k);
    }
    return { posts, v, rare, head, named, sources: new Set(posts.map(sourceOf)), first: Math.min(...times), last: Math.max(...times) };
  });
  items.sort((a, b) => a.first - b.first);

  const window = windowHours * 3_600_000;
  const stories = [];
  for (const it of items) {
    let best = null;
    let bestSim = threshold;
    if (it.v.size) {
      for (const s of stories) {
        if (it.first - s.last > window || s.first - it.last > window) continue;
        const sim = cosine(it.v, s.v);
        if (sim < bestSim) continue;
        // One outlet's unrelated posts often share its own phrasing.
        const oneSource = s.sources.size === 1 && it.sources.size === 1 && s.sources.has([...it.sources][0]);
        if (oneSource && sim < sameSourceThreshold) continue;
        // Enough rare details in common with one member, not just with the mix,
        // and at least one of them in both headlines (not only in a summary).
        if (!s.parts.some((part) => sharedDetails(it.rare, part.rare) >= minShared)) continue;
        if (!s.parts.some((part) => overlaps(it.head, part.head))) continue;
        // Different places or people in the headlines: a different event.
        if (namesConflict(it.named, s.named)) continue;
        best = s;
        bestSim = sim;
      }
    }
    if (best) {
      best.posts.push(...it.posts);
      for (const [k, x] of it.v) best.v.set(k, (best.v.get(k) || 0) + x);
      best.parts.push(it);
      for (const k of it.named.words) best.named.words.add(k);
      for (const src of it.sources) best.sources.add(src);
      best.first = Math.min(best.first, it.first);
      best.last = Math.max(best.last, it.last);
      best.matched = true;
    } else {
      // A storyline keeps its first report's names and everyone's words.
      const named = { names: new Set(it.named.names), words: new Set(it.named.words) };
      stories.push({ ...it, posts: [...it.posts], v: new Map(it.v), parts: [it], named, sources: new Set(it.sources), matched: false });
    }
  }
  return stories.map((s) => ({ posts: s.posts, matched: s.matched }));
}
