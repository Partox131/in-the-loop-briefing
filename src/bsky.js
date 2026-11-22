// Minimal Bluesky (AT Protocol) HTTP client. No dependencies: Node 22 fetch.
//
// Two ways to call the AppView (the service that indexes the network and
// answers search/profile queries):
//   1. Unauthenticated, via https://public.api.bsky.app (cached public mirror).
//   2. Authenticated with an app password: log in at your PDS (bsky.social
//      for most accounts) and call through it; the PDS proxies the request to
//      the AppView. Search is sometimes refused or rate-limited on the public
//      mirror, so the CLI uses (2) when BSKY_HANDLE/BSKY_APP_PASSWORD are set.

import { fromPostView } from './normalize.js';

const PUBLIC_APPVIEW = 'https://public.api.bsky.app';
const ENTRYWAY = 'https://bsky.social';
const APPVIEW_PROXY = 'did:web:api.bsky.app#bsky_appview';

export class BskyClient {
  constructor({ handle, appPassword, fetchImpl = globalThis.fetch, log = () => {} } = {}) {
    this.handle = handle;
    this.appPassword = appPassword;
    this.fetch = fetchImpl;
    this.log = log;
    this.session = null; // { accessJwt, pds }
    this.profileCache = new Map(); // did -> { handle, displayName }
  }

  get authenticated() {
    return Boolean(this.handle && this.appPassword);
  }

  async login() {
    if (this.session || !this.authenticated) return;
    const res = await this.fetch(`${ENTRYWAY}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: this.handle, password: this.appPassword }),
    });
    if (!res.ok) throw new Error(`Bluesky login failed (${res.status}): ${await res.text()}`);
    const body = await res.json();
    const pds = body.didDoc?.service?.find((s) => s.id === '#atproto_pds')?.serviceEndpoint;
    this.session = { accessJwt: body.accessJwt, pds: pds || ENTRYWAY };
    this.log(`Logged in as ${body.handle} via ${this.session.pds}`);
  }

  /** GET an XRPC query on the AppView, with retry on 429/5xx. */
  async query(nsid, params, { auth = this.authenticated } = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      for (const item of Array.isArray(v) ? v : [v]) qs.append(k, String(item));
    }
    let base = PUBLIC_APPVIEW;
    const headers = {};
    if (auth) {
      await this.login();
      base = this.session.pds;
      headers.authorization = `Bearer ${this.session.accessJwt}`;
      headers['atproto-proxy'] = APPVIEW_PROXY;
    }
    const url = `${base}/xrpc/${nsid}?${qs}`;
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetch(url, { headers });
      if (res.ok) return res.json();
      const retriable = res.status === 429 || res.status >= 500;
      if (!retriable || attempt >= 3) {
        const text = await res.text().catch(() => '');
        const hint =
          res.status === 403 && !auth
            ? ' (the public endpoint refused this; set BSKY_HANDLE and BSKY_APP_PASSWORD to search with a logged-in account)'
            : '';
        throw new Error(`${nsid} failed (${res.status})${hint}: ${text.slice(0, 300)}`);
      }
      const wait = Number(res.headers.get('retry-after')) * 1000 || 1000 * 2 ** attempt;
      this.log(`${nsid}: HTTP ${res.status}, retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  /**
   * app.bsky.feed.searchPosts, paginated. Returns normalised posts.
   * @param {object} o
   * @param {string} o.q          query (Bluesky search syntax; quotes for phrases)
   * @param {'latest'|'top'} [o.sort]
   * @param {string} [o.since]    ISO datetime lower bound
   * @param {string} [o.lang]
   * @param {number} [o.max]      max posts to collect (100 per page)
   */
  async searchPosts({ q, sort = 'latest', since, until, lang, max = 100 }) {
    const out = [];
    let cursor;
    while (out.length < max) {
      const limit = Math.min(100, max - out.length);
      const page = await this.query('app.bsky.feed.searchPosts', { q, sort, since, until, lang, limit, cursor });
      for (const pv of page.posts || []) out.push(fromPostView(pv));
      if (!page.cursor || !(page.posts || []).length) break;
      cursor = page.cursor;
    }
    return out;
  }

  /**
   * app.bsky.feed.getAuthorFeed: an account's own recent posts (no reposts or
   * replies to others). Public and reliable, unlike search, so it's how we
   * backfill posts from known voices.
   */
  async authorFeed(actor, { since, max = 50 } = {}) {
    const out = [];
    let cursor;
    while (out.length < max) {
      const page = await this.query(
        'app.bsky.feed.getAuthorFeed',
        { actor, filter: 'posts_no_replies', limit: Math.min(100, max - out.length), cursor },
        { auth: false },
      );
      const items = page.feed || [];
      for (const item of items) {
        if (item.reason) continue; // a repost, not their own post
        const p = fromPostView(item.post);
        if (since && new Date(p.createdAt) < since) return out;
        out.push(p);
      }
      if (!page.cursor || !items.length) break;
      cursor = page.cursor;
    }
    return out;
  }

  /** Resolve DIDs to handles/display names (batched, cached). Public endpoint. */
  async profiles(dids) {
    const missing = [...new Set(dids)].filter((d) => !this.profileCache.has(d));
    for (let i = 0; i < missing.length; i += 25) {
      const batch = missing.slice(i, i + 25);
      try {
        const res = await this.query('app.bsky.actor.getProfiles', { actors: batch }, { auth: false });
        for (const p of res.profiles || []) {
          this.profileCache.set(p.did, { handle: p.handle, displayName: p.displayName || undefined });
        }
      } catch (err) {
        this.log(`profile lookup failed: ${err.message}`);
      }
      for (const d of batch) if (!this.profileCache.has(d)) this.profileCache.set(d, {});
    }
    return this.profileCache;
  }
}
