// snapshot.json: everything the pages need, fetched once on our server for
// every visitor (scripts/worker.js), instead of each browser calling
// Bluesky once per voice (about 70 requests) and loading news.json.
//
// The snapshot holds the raw inputs, not finished views: the voices' posts
// from the last 48 hours (with engagement counts), the voices' resolved
// profiles, and the news collector's output. The pages still run the same
// pipeline (brief.js, live.js) in the browser, so every node and time window
// works from one file.
//
// SnapshotClient stands in for BskyClient: author feeds and profile lookups
// are answered from the snapshot when it is fresh and covers the window,
// otherwise they go to Bluesky directly as before. So if the server is down
// or late, the page quietly falls back to browser-only mode.
//
// Browser-safe: no Node imports. No AI.

export const SNAPSHOT_VERSION = 1;
/** Older than this, the snapshot is ignored and the page reads Bluesky directly. */
export const MAX_AGE_MS = 20 * 60_000;

/**
 * Build the snapshot document (server side).
 * @param {object} o
 * @param {Iterable<object>} o.posts     normalised posts (normalize.js), any order
 * @param {Array<{handle:string,did:string,verified?:boolean}>} o.profiles  resolved voices
 * @param {object|null} o.news           the news collector's document (collect-news.js)
 * @param {Date} o.now
 * @param {number} [o.hours]             how far back the posts go
 * @param {number} [o.perVoice]          newest posts kept per account
 * @param {object} [o.status]            worker health, shown for debugging
 */
export function buildSnapshot({ posts, profiles, news, now, hours = 48, perVoice = 100, status = {} }) {
  const cutoff = now.getTime() - hours * 3_600_000;
  const byDid = new Map();
  for (const p of posts) {
    const at = Date.parse(p.createdAt);
    if (!(at >= cutoff)) continue;
    if (!byDid.has(p.did)) byDid.set(p.did, []);
    byDid.get(p.did).push(p);
  }
  const kept = [];
  for (const list of byDid.values()) {
    list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    kept.push(...list.slice(0, perVoice));
  }
  kept.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return {
    version: SNAPSHOT_VERSION,
    generatedAt: now.toISOString(),
    about: 'In the Loop snapshot: posts from tracked Bluesky voices plus news articles (RSS, GDELT, Telegram), fetched once by the In the Loop server. No AI. Telegram content must not be used with AI (Telegram terms).',
    hours,
    status,
    profiles: profiles.map(({ handle, did, verified }) => ({ handle, did, ...(verified ? { verified: true } : {}) })),
    posts: kept,
    news: news || null,
  };
}

/** Is this snapshot fresh, and does it reach back to `since`? */
export function snapshotCovers(snap, { now = new Date(), since } = {}) {
  if (!snap || snap.version !== SNAPSHOT_VERSION || !Array.isArray(snap.posts)) return false;
  const at = Date.parse(snap.generatedAt);
  if (!(now.getTime() - at <= MAX_AGE_MS)) return false;
  if (since && since.getTime() < at - snap.hours * 3_600_000) return false;
  return true;
}

/**
 * A BskyClient look-alike backed by snapshot.json, falling back to `fallback`
 * (a real BskyClient) when the snapshot is missing, stale or too short.
 */
export class SnapshotClient {
  constructor({ url, fallback, fetchImpl = globalThis.fetch, cacheMs = 60_000, timeoutMs = 6_000, now = () => new Date() }) {
    this.url = url;
    this.fallback = fallback;
    this.fetch = fetchImpl === globalThis.fetch ? fetchImpl.bind(globalThis) : fetchImpl;
    this.cacheMs = cacheMs;
    this.timeoutMs = timeoutMs;
    this.now = now;
    this.cached = null; // { at, snap, index }
    this.pending = null;
    /** 'server' when the last answer came from the snapshot, 'direct' when from Bluesky. */
    this.mode = null;
  }

  get profileCache() {
    return this.fallback.profileCache;
  }

  /** The snapshot, fetched at most once per `cacheMs`; null if unavailable. */
  async snapshot() {
    const t = this.now().getTime();
    if (this.cached && t - this.cached.at < this.cacheMs) return this.cached.snap;
    if (!this.pending) {
      this.pending = (async () => {
        let snap = null;
        try {
          const res = await this.fetch(this.url, { cache: 'no-cache', signal: AbortSignal.timeout(this.timeoutMs) });
          if (res.ok) snap = await res.json();
        } catch {
          snap = null;
        }
        // A failed fetch keeps the last good snapshot; snapshotCovers drops it once it's too old.
        if (!snap && this.cached?.snap) snap = this.cached.snap;
        const index = new Map();
        for (const p of snap?.posts || []) {
          if (!index.has(p.did)) index.set(p.did, []);
          index.get(p.did).push(p);
        }
        this.cached = { at: this.now().getTime(), snap, index };
        this.pending = null;
        return snap;
      })();
    }
    return this.pending;
  }

  /** The snapshot if it is fresh and reaches back to `since`, else null. */
  async usable(since) {
    const snap = await this.snapshot();
    return snapshotCovers(snap, { now: this.now(), since }) ? snap : null;
  }

  async authorFeed(actor, { since, max = 50 } = {}) {
    if (await this.usable(since)) {
      this.mode = 'server';
      const list = this.cached.index.get(actor) || [];
      return list.filter((p) => !since || new Date(p.createdAt) >= since).slice(0, max);
    }
    this.mode = 'direct';
    return this.fallback.authorFeed(actor, { since, max });
  }

  async query(nsid, params, opts) {
    // Voice lookups (resolveVoices) come from the snapshot when it knows every handle asked for.
    if (nsid === 'app.bsky.actor.getProfiles') {
      const snap = await this.usable();
      if (snap) {
        const byHandle = new Map(snap.profiles.map((p) => [p.handle, p]));
        const actors = [params.actors].flat();
        if (actors.every((a) => byHandle.has(String(a).toLowerCase()))) {
          return {
            profiles: actors.map((a) => {
              const p = byHandle.get(String(a).toLowerCase());
              return { did: p.did, handle: p.handle, ...(p.verified ? { verification: { verifiedStatus: 'valid' } } : {}) };
            }),
          };
        }
      }
    }
    return this.fallback.query(nsid, params, opts);
  }

  searchPosts(o) {
    return this.fallback.searchPosts(o);
  }

  profiles(dids) {
    return this.fallback.profiles(dids);
  }

  /** The news collector's document from a usable snapshot, or null. */
  async news() {
    const snap = await this.usable();
    return snap?.news || null;
  }
}
