// News articles from outlets' RSS/Atom feeds and from GDELT, as a second
// source next to Bluesky. Bluesky tells us what people react to; feeds and
// GDELT tell us what was actually published.
//
// Browsers can't read most feeds (no CORS) and GDELT allows one request
// every 5 seconds, so a scheduled job (scripts/collect-news.js, run by the
// public site's GitHub Actions workflow) collects them into news.json. The
// page then turns each article into a "post" from its outlet, so the
// existing pipeline (classify, rank, storylines, map) handles it, and a
// Bluesky post linking to the same article joins the same storyline.
//
// Browser-safe: no Node imports. No AI: parsing and matching are rules.

import { canonicalUrl } from './storylines.js?v=6496a5eb2a';
import { makeVoice } from './voices.js?v=6496a5eb2a';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(n);
      } catch {
        return m;
      }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Plain text from a feed field: CDATA unwrapped, tags dropped, entities decoded, spaces squashed. */
export function plainText(s) {
  let t = String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  // Feeds often escape their HTML, so decode first, then drop tags, then decode again.
  t = decodeEntities(t).replace(/<[^>]*>/g, ' ');
  return decodeEntities(t).replace(/\s+/g, ' ').trim();
}

function field(block, names) {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i'));
    if (m && m[1].trim()) return m[1];
  }
  return '';
}

function toIso(s) {
  const t = Date.parse(plainText(s));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Items of an RSS 2.0, RSS 1.0 (RDF) or Atom feed.
 * @returns {{ title: string, url: string, summary: string, published: string|null }[]}
 */
export function parseFeed(xml) {
  const text = String(xml || '');
  const blocks = [...text.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((m) => m[2]);
  const out = [];
  for (const b of blocks) {
    let url = plainText(field(b, ['link']));
    if (!url) {
      // Atom: <link rel="alternate" href="…"/> (or the first link without rel).
      const links = [...b.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
      const alt = links.find((a) => /rel=["']alternate["']/i.test(a)) || links.find((a) => !/rel=/i.test(a)) || links[0];
      url = alt?.match(/href=["']([^"']+)["']/i)?.[1] || '';
      url = decodeEntities(url);
    }
    if (!url) {
      const guid = plainText(field(b, ['guid']));
      if (/^https?:\/\//.test(guid)) url = guid;
    }
    const title = plainText(field(b, ['title']));
    if (!url || !title || !/^https?:\/\//.test(url)) continue;
    out.push({
      title,
      url,
      summary: plainText(field(b, ['description', 'summary', 'content:encoded', 'content'])).slice(0, 400),
      published: toIso(field(b, ['pubDate', 'published', 'dc:date', 'updated'])),
    });
  }
  return out;
}

/** GDELT seendate "20261122T213000Z" -> ISO. */
export function gdeltDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || '');
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : null;
}

/** Articles from a GDELT DOC 2.0 API response (mode=artlist, format=json). */
export function parseGdelt(json) {
  return (json?.articles || [])
    .filter((a) => a.url && a.title)
    .map((a) => ({
      title: plainText(a.title),
      url: a.url,
      summary: '',
      published: gdeltDate(a.seendate),
      domain: a.domain,
      language: a.language,
      sourceCountry: a.sourcecountry,
    }));
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * The outlets we list, looked up by an article's web address
 * (bbc.co.uk matches www.bbc.co.uk and news.bbc.co.uk).
 * @param {Array<{domain:string, domains?:string[], name:string, affiliation?:string, region?:string, stateAffiliated?:boolean, topics?:string[]}>} outlets
 */
export function makeOutlets(outlets = []) {
  const byDomain = new Map();
  for (const o of outlets) for (const d of [o.domain, ...(o.domains || [])]) byDomain.set(d.toLowerCase(), o);
  return {
    list: outlets,
    forUrl(url) {
      let host = hostOf(url);
      // Telegram channels are listed as "t.me/<channel>" (see telegramOutlets).
      if (host === 't.me') return byDomain.get(`t.me/${telegramChannelOf(url)}`) || null;
      while (host) {
        if (byDomain.has(host)) return byDomain.get(host);
        const dot = host.indexOf('.');
        if (dot < 0) break;
        host = host.slice(dot + 1);
      }
      return null;
    },
  };
}

/**
 * Merge article lists: one entry per canonical URL, the earliest time, every
 * source it came from (an article in a feed and in GDELT is one article).
 */
export function mergeArticles(...lists) {
  const byKey = new Map();
  for (const a of lists.flat()) {
    const key = canonicalUrl(a.url);
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...a, via: [...new Set(a.via || [])] });
      continue;
    }
    const times = [prev.published, a.published].filter(Boolean).sort();
    byKey.set(key, {
      ...prev,
      summary: prev.summary || a.summary,
      ...(prev.language || a.language ? { language: prev.language || a.language } : {}),
      // Telegram view counts grow: keep the latest one seen.
      ...(a.views != null ? { views: a.views } : {}),
      ...(prev.links || a.links ? { links: [...new Set([...(prev.links || []), ...(a.links || [])])] } : {}),
      published: times[0] || null,
      via: [...new Set([...(prev.via || []), ...(a.via || [])])],
    });
  }
  return [...byKey.values()];
}

/** The voice an outlet's articles are attributed to (tier 1, keyed by "news:<domain>"). */
export function outletVoice(o) {
  return {
    ...makeVoice({
      handle: o.domain,
      did: `news:${o.domain}`,
      name: o.name,
      tier: o.tier || 1,
      affiliation: o.affiliation || o.name,
      region: o.region,
      stateAffiliated: o.stateAffiliated,
      country: o.country,
      lean: o.lean,
      topics: o.topics || ['geopolitics'],
    }),
    news: true,
    ...(o.telegram ? { telegram: true } : {}),
  };
}

/**
 * Turn news.json into posts the pipeline understands. Articles from outlets
 * we don't list are dropped (GDELT includes many sites of unknown standing).
 * @returns {{ posts: Array, voices: Map<string, object>, generatedAt: string|null }}
 */
export function newsPosts(doc) {
  const outlets = makeOutlets(doc?.outlets || []);
  const voices = new Map();
  const posts = [];
  for (const a of doc?.articles || []) {
    const o = outlets.forUrl(a.url);
    if (!o || !a.published) continue;
    const did = `news:${o.domain}`;
    if (!voices.has(did)) voices.set(did, outletVoice(o));
    posts.push({
      uri: `news:${canonicalUrl(a.url) || a.url}`,
      url: a.url,
      did,
      handle: o.domain,
      displayName: o.name,
      text: a.summary && !a.summary.startsWith(a.title) ? `${a.title}. ${a.summary}` : a.title,
      title: a.title,
      tags: [],
      // A Telegram post's own links (e.g. to an outlet's article) join that article's storyline.
      links: [a.url, ...(a.links || [])],
      langs: a.language && a.language !== 'English' ? [] : ['en'],
      createdAt: a.published,
      isReply: false,
      counts: undefined,
      source: 'news',
      via: a.via || [],
      ...(o.telegram ? { telegram: true, views: a.views } : {}),
    });
  }
  return { posts, voices, generatedAt: doc?.generatedAt || null };
}

// ---------------------------------------------------------------------------
// Telegram public channels (docs/research/telegram.md). Each public channel
// has a web preview at https://t.me/s/<channel> with its latest ~20 posts.
// Browsers can't read it (no CORS), so the scheduled collector does. We keep
// a short excerpt and link to the post on Telegram, never the full post or
// media, and Telegram content must never go to an AI (Telegram's terms).

/** "https://t.me/PressTV/123" or "https://t.me/s/PressTV" -> "presstv". */
export function telegramChannelOf(url) {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    return ((parts[0] === 's' ? parts[1] : parts[0]) || '').toLowerCase();
  } catch {
    return '';
  }
}

/** Channels from news.sources.json ("telegram.channels") as outlets keyed "t.me/<channel>". */
export function telegramOutlets(channels = []) {
  return channels.map((c) => ({
    domain: `t.me/${c.channel.toLowerCase()}`,
    name: c.name,
    affiliation: c.affiliation || c.name,
    region: c.region,
    tier: c.tier || 1,
    stateAffiliated: c.stateAffiliated || undefined,
    country: c.country,
    topics: c.topics || ['geopolitics'],
    language: c.language,
    telegram: true,
  }));
}

/** "3.03K" -> 3030, "1.2M" -> 1200000. */
export function parseCount(s) {
  const m = /([\d.]+)\s*([KM]?)/i.exec(String(s || ''));
  if (!m) return undefined;
  const n = parseFloat(m[1]) * ({ k: 1e3, m: 1e6 }[m[2].toLowerCase()] || 1);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

const EXCERPT = 280;

/**
 * Posts in a t.me/s/<channel> page. Skips service messages (pins), forwarded
 * posts (they come from other, unchecked channels) and posts without text.
 * @returns {{ verified: boolean, posts: { title, url, summary, published, views, links }[] }}
 */
export function parseTelegram(html) {
  const page = String(html || '');
  const header = page.slice(page.indexOf('tgme_channel_info'), page.indexOf('tgme_channel_info_counters'));
  const verified = page.includes('tgme_channel_info') && /verified-icon/.test(header);
  const posts = [];
  for (const block of page.split(/<div class="tgme_widget_message_wrap/).slice(1)) {
    const post = /data-post="([^"\/]+)\/(\d+)"/.exec(block);
    if (!post || /service_message/.test(block.slice(0, 300)) || /tgme_widget_message_forwarded_from/.test(block)) continue;
    const textHtml = /<div class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/.exec(block)?.[1];
    if (!textHtml) continue;
    const links = [...textHtml.matchAll(/<a\b[^>]*href="([^"]+)"/gi)]
      .map((m) => decodeEntities(m[1]))
      .filter((u) => /^https?:\/\//.test(u) && hostOf(u) !== 't.me');
    // Emoji come as <i class="emoji"><b>🔴</b></i>; keep the character, drop the markup.
    const lines = textHtml
      .replace(/<br\s*\/?>/gi, '\n')
      .split('\n')
      .map((l) => plainText(l))
      .filter((l) => l && !/^@\w+$/.test(l)); // the channel's own "@PressTV" signature
    const text = lines.join(' ').trim();
    if (!text) continue;
    // A short lead-in ("Iran's Parliament Speaker Ghalibaf:") needs the next line to make sense.
    const head = lines[0].length < 40 || /:$/.test(lines[0]) ? 2 : 1;
    const first = lines.slice(0, head).join(' ');
    const title = first.length > 200 ? `${first.slice(0, 197).replace(/\s+\S*$/, '')}…` : first;
    const rest = lines.slice(head).join(' ');
    const time = /<time datetime="([^"]+)"/.exec(block)?.[1];
    const published = time && !Number.isNaN(Date.parse(time)) ? new Date(time).toISOString() : null;
    posts.push({
      title,
      url: `https://t.me/${post[1]}/${post[2]}`,
      summary: rest.length > EXCERPT ? `${rest.slice(0, EXCERPT - 1).replace(/\s+\S*$/, '')}…` : rest,
      published,
      views: parseCount(/<span class="tgme_widget_message_views">([^<]*)</.exec(block)?.[1]),
      links: [...new Set(links)],
    });
  }
  return { verified, posts };
}
