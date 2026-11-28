// Publishing approved social posts (Studio, scripts/studio.js).
//
// Amir, 28 Nov 2026: one tap on Approve in Studio publishes a post everywhere.
// Nothing here runs on its own: scripts/studio.js calls these only after Amir
// approves a post on the Studio page, signed in with his password.
//
// Routes (all free):
//   Bluesky    AT Protocol, app password            text + link card
//   Threads    Threads API, own account as tester    text
//   Instagram  Instagram API (Instagram login)       the daily video as a Reel
//   X, TikTok, YouTube  Buffer's API (free plan, 3 channels): X text with the
//              link in a reply (thread), the daily video on TikTok and as a Short
//
// Every function takes `deps` ({ fetch, sleep }) so tests can stand in for the
// networks. No dependencies.

export const LIMITS = { bluesky: 300, threads: 500, x: 280, instagram: 2200, tiktok: 2200, youtubeTitle: 100, youtube: 5000 };
export const CHANNELS = ['bluesky', 'threads', 'x', 'instagram', 'tiktok', 'youtube'];
export const VIA_BUFFER = { x: 'twitter', tiktok: 'tiktok', youtube: 'youtube' };
export const LABEL = { bluesky: 'Bluesky', threads: 'Threads', x: 'X', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube' };

const BSKY = 'https://bsky.social/xrpc';
const THREADS = 'https://graph.threads.net/v1.0';
const IG = 'https://graph.instagram.com/v23.0';
const BUFFER = 'https://api.buffer.com';

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
/** Characters as people count them (Bluesky counts graphemes). */
export const graphemes = (s) => (segmenter ? [...segmenter.segment(s)].length : [...s].length);
/** X counts every link as 23 characters. */
export const xLength = (s) => [...s.replace(/https?:\/\/\S+/g, 'x'.repeat(23))].length;

/** Length of `text` as `channel` counts it. */
export function lengthFor(channel, text) {
  if (channel === 'x') return xLength(text);
  if (channel === 'bluesky') return graphemes(text);
  return [...text].length;
}

/**
 * The publishable items of one draft post (the Daily posts JSON), keyed by channel.
 * Text posts carry Bluesky / Threads / X; the daily video carries TikTok /
 * Instagram / YouTube title + description.
 */
export function itemsOf(post) {
  const out = {};
  for (const p of post.platforms || []) {
    const name = String(p.platform || '').toLowerCase();
    if (name === 'bluesky') out.bluesky = { text: p.text };
    else if (name === 'threads') out.threads = { text: p.text };
    else if (name === 'x') out.x = { text: p.text, ...(p.reply ? { reply: p.reply } : {}) };
    else if (name === 'tiktok') out.tiktok = { text: p.text };
    else if (name === 'instagram') out.instagram = { text: p.text };
    else if (name === 'youtube title') out.youtube = { ...(out.youtube || {}), title: p.text };
    else if (name === 'youtube description') out.youtube = { ...(out.youtube || {}), text: p.text };
  }
  if (!post.video) { delete out.tiktok; delete out.instagram; delete out.youtube; }
  return out;
}

/** Problems with an item before it is sent (empty list = fine). */
export function checkItem(channel, item, { video } = {}) {
  const errs = [];
  const text = String(item?.text || '');
  if (!CHANNELS.includes(channel)) return ['unknown channel'];
  if (!text.trim()) errs.push('text is empty');
  if (lengthFor(channel, text) > LIMITS[channel]) errs.push(`text is over ${LIMITS[channel]} characters`);
  if (channel === 'x' && item.reply && xLength(item.reply) > LIMITS.x) errs.push('reply is over 280 characters');
  if (channel === 'youtube') {
    const t = String(item.title || '');
    if (!t.trim()) errs.push('title is empty');
    if ([...t].length > LIMITS.youtubeTitle) errs.push('title is over 100 characters');
  }
  if (['instagram', 'tiktok', 'youtube'].includes(channel) && !video) errs.push('needs the video');
  return errs;
}

// ---------- helpers ----------

async function call(deps, url, init = {}, what = url) {
  const res = await deps.fetch(url, init);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || body?.error || text.slice(0, 200) || res.statusText;
    const err = new Error(`${what}: ${res.status} ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    err.status = res.status;
    throw err;
  }
  return body;
}
const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]));

// ---------- Bluesky ----------

const URL_RE = /https?:\/\/[^\s<>"]+/g;
/** Link facets for every URL in `text` (byte offsets, as the AT Protocol wants). */
export function linkFacets(text) {
  const enc = new TextEncoder();
  const facets = [];
  for (const m of text.matchAll(URL_RE)) {
    let uri = m[0].replace(/[.,;:!?)\]'"]+$/, '');
    const start = enc.encode(text.slice(0, m.index)).length;
    facets.push({ index: { byteStart: start, byteEnd: start + enc.encode(uri).length }, features: [{ $type: 'app.bsky.richtext.facet#link', uri }] });
  }
  return facets;
}

/** og:title / og:description / og:image from a page's HTML. */
export function openGraph(html) {
  const get = (p) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*>`, 'i');
    const tag = html.match(re)?.[0];
    const v = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    return v ? v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>') : '';
  };
  return { title: get('og:title') || html.match(/<title>([^<]*)<\/title>/i)?.[1] || '', description: get('og:description') || get('description'), image: get('og:image') };
}

export async function blueskySession(deps, { identifier, appPassword }) {
  return call(deps, `${BSKY}/com.atproto.server.createSession`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: appPassword }),
  }, 'Bluesky sign-in');
}

/** A link card for the first link in the text, or null if anything fails. */
async function blueskyCard(deps, session, text) {
  const uri = linkFacets(text)[0]?.features[0].uri;
  if (!uri) return null;
  try {
    const page = await deps.fetch(uri, { headers: { 'User-Agent': 'InTheLoopStudio/1.0 (+https://inthelooplive.com)' } });
    if (!page.ok) return null;
    const og = openGraph(await page.text());
    if (!og.title) return null;
    const external = { uri, title: og.title.slice(0, 300), description: og.description.slice(0, 1000) };
    if (og.image) {
      const img = await deps.fetch(new URL(og.image, uri).href);
      const type = img.headers.get('content-type') || 'image/png';
      const bytes = Buffer.from(await img.arrayBuffer());
      if (img.ok && bytes.length < 1_000_000 && type.startsWith('image/')) {
        const up = await call(deps, `${BSKY}/com.atproto.repo.uploadBlob`, { method: 'POST', headers: { 'Content-Type': type, Authorization: `Bearer ${session.accessJwt}` }, body: bytes }, 'Bluesky image');
        external.thumb = up.blob;
      }
    }
    return { $type: 'app.bsky.embed.external', external };
  } catch {
    return null;
  }
}

export async function postBluesky(deps, creds, { text }, { now = () => new Date() } = {}) {
  const s = await blueskySession(deps, creds);
  const record = { $type: 'app.bsky.feed.post', text, createdAt: now().toISOString(), langs: ['en'] };
  const facets = linkFacets(text);
  if (facets.length) record.facets = facets;
  const embed = await blueskyCard(deps, s, text);
  if (embed) record.embed = embed;
  const r = await call(deps, `${BSKY}/com.atproto.repo.createRecord`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.accessJwt}` },
    body: JSON.stringify({ repo: s.did, collection: 'app.bsky.feed.post', record }),
  }, 'Bluesky post');
  const rkey = String(r.uri).split('/').pop();
  return { id: r.uri, url: `https://bsky.app/profile/${s.handle || s.did}/post/${rkey}` };
}

// ---------- Threads ----------

export async function threadsMe(deps, token) {
  return call(deps, `${THREADS}/me?${form({ fields: 'id,username', access_token: token })}`, {}, 'Threads account');
}

export async function postThreads(deps, { token }, { text }) {
  const c = await call(deps, `${THREADS}/me/threads`, { method: 'POST', body: form({ media_type: 'TEXT', text, access_token: token }) }, 'Threads draft');
  const p = await call(deps, `${THREADS}/me/threads_publish`, { method: 'POST', body: form({ creation_id: c.id, access_token: token }) }, 'Threads publish');
  let url = null;
  try { url = (await call(deps, `${THREADS}/${p.id}?${form({ fields: 'permalink', access_token: token })}`)).permalink || null; } catch { /* the post is up anyway */ }
  return { id: p.id, url };
}

export async function refreshThreads(deps, token) {
  return call(deps, `https://graph.threads.net/refresh_access_token?${form({ grant_type: 'th_refresh_token', access_token: token })}`, {}, 'Threads token refresh');
}

// ---------- Instagram ----------

export async function instagramMe(deps, token) {
  return call(deps, `${IG}/me?${form({ fields: 'user_id,username', access_token: token })}`, {}, 'Instagram account');
}

/** The daily video as a Reel: make a container, wait until Instagram has processed it, publish. */
export async function postInstagram(deps, { token }, { text }, { videoUrl, waitMs = 10_000, tries = 60 } = {}) {
  const c = await call(deps, `${IG}/me/media`, { method: 'POST', body: form({ media_type: 'REELS', video_url: videoUrl, caption: text, share_to_feed: 'true', access_token: token }) }, 'Instagram upload');
  for (let i = 0; ; i++) {
    const st = await call(deps, `${IG}/${c.id}?${form({ fields: 'status_code,status', access_token: token })}`, {}, 'Instagram processing');
    if (st.status_code === 'FINISHED') break;
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error(`Instagram processing: ${st.status || st.status_code}`);
    if (i >= tries) throw new Error('Instagram processing: still not ready after 10 minutes');
    await deps.sleep(waitMs);
  }
  const p = await call(deps, `${IG}/me/media_publish`, { method: 'POST', body: form({ creation_id: c.id, access_token: token }) }, 'Instagram publish');
  let url = null;
  try { url = (await call(deps, `${IG}/${p.id}?${form({ fields: 'permalink', access_token: token })}`)).permalink || null; } catch { /* published anyway */ }
  return { id: p.id, url };
}

export async function refreshInstagram(deps, token) {
  return call(deps, `https://graph.instagram.com/refresh_access_token?${form({ grant_type: 'ig_refresh_token', access_token: token })}`, {}, 'Instagram token refresh');
}

// ---------- Buffer (X, TikTok, YouTube) ----------

export async function bufferQuery(deps, apiKey, query, variables = {}) {
  const r = await call(deps, BUFFER, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ query, variables }),
  }, 'Buffer');
  if (r?.errors?.length) throw new Error(`Buffer: ${r.errors.map((e) => e.message).join('; ')}`);
  return r.data;
}

/** Buffer channels by our channel name: { x: {id, name}, tiktok: …, youtube: … }. */
export async function bufferChannels(deps, apiKey) {
  const d = await bufferQuery(deps, apiKey, 'query { account { organizations { id name } } }');
  const out = {};
  for (const org of d.account?.organizations || []) {
    const c = await bufferQuery(deps, apiKey, 'query($o: OrganizationId!) { channels(input: { organizationId: $o }) { id name displayName service isDisconnected } }', { o: org.id });
    for (const ch of c.channels || []) {
      const ours = Object.keys(VIA_BUFFER).find((k) => VIA_BUFFER[k] === String(ch.service).toLowerCase());
      if (ours && !out[ours] && !ch.isDisconnected) out[ours] = { id: ch.id, name: ch.displayName || ch.name, organizationId: org.id };
    }
  }
  return out;
}

const CREATE = `mutation($input: CreatePostInput!) { createPost(input: $input) {
  ... on PostActionSuccess { post { id status externalLink } }
  ... on MutationError { message }
} }`;

/** The createPost input for one of our Buffer channels. */
export function bufferInput(channel, channelId, item, { videoUrl } = {}) {
  const input = { channelId, text: item.text, schedulingType: 'automatic', mode: 'shareNow', assets: [], source: 'in-the-loop-studio' };
  if (channel === 'x' && item.reply) input.metadata = { twitter: { thread: [{ text: item.text }, { text: item.reply }] } };
  if (channel === 'tiktok') { input.assets = [{ video: { url: videoUrl } }]; input.metadata = { tiktok: { isAiGenerated: false } }; }
  if (channel === 'youtube') {
    input.assets = [{ video: { url: videoUrl } }];
    // 25 = News & Politics. Public Short, not for kids.
    input.metadata = { youtube: { title: item.title, categoryId: '25', privacy: 'public', type: 'short', madeForKids: false, notifySubscribers: true } };
  }
  return input;
}

export async function postBuffer(deps, { apiKey, channels }, channel, item, { videoUrl } = {}) {
  const ch = channels?.[channel];
  if (!ch) throw new Error(`Buffer has no ${LABEL[channel]} channel connected`);
  const d = await bufferQuery(deps, apiKey, CREATE, { input: bufferInput(channel, ch.id, item, { videoUrl }) });
  const r = d.createPost;
  if (!r?.post) throw new Error(`Buffer: ${r?.message || 'post not created'}`);
  return { id: r.post.id, url: r.post.externalLink || null, status: r.post.status };
}

/** Where a Buffer post is now: { status: 'sent'|'error'|'sending'|…, url, error }. */
export async function bufferStatus(deps, apiKey, id) {
  const d = await bufferQuery(deps, apiKey, 'query($id: PostId!) { post(input: { id: $id }) { id status externalLink error { message } } }', { id });
  return { status: d.post?.status, url: d.post?.externalLink || null, error: d.post?.error?.message || null };
}
