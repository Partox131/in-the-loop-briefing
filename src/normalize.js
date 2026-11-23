// Bluesky gives us posts in two shapes: "PostView" objects from the AppView
// search API (with author profile + engagement counts) and raw
// app.bsky.feed.post records from Jetstream (just a DID and the record).
// Both are normalised into one shape so the rest of the tool doesn't care.

/**
 * @typedef {Object} Post
 * @property {string} uri         at://did/app.bsky.feed.post/rkey
 * @property {string} url         https://bsky.app/profile/.../post/rkey
 * @property {string} did
 * @property {string|undefined} handle
 * @property {string|undefined} displayName
 * @property {string} text
 * @property {string[]} tags       hashtags (from facets + record.tags)
 * @property {string[]} links      external links (from facets + link card embed)
 * @property {string|undefined} linkTitle  headline of the link card, if any
 * @property {string[]} langs
 * @property {string} createdAt
 * @property {boolean} isReply
 * @property {string|undefined} replyParent  uri of the post this replies to
 * @property {string|undefined} quotedUri
 * @property {{likes:number,reposts:number,replies:number,quotes:number}|undefined} counts
 * @property {'search'|'live'} source
 */

export function postUrl(did, uri, handle) {
  const rkey = uri.split('/').pop();
  return `https://bsky.app/profile/${handle || did}/post/${rkey}`;
}

function fromRecord(record) {
  const tags = new Set(record.tags || []);
  const links = new Set();
  for (const facet of record.facets || []) {
    for (const f of facet.features || []) {
      if (f.$type === 'app.bsky.richtext.facet#tag' && f.tag) tags.add(f.tag);
      if (f.$type === 'app.bsky.richtext.facet#link' && f.uri) links.add(f.uri);
    }
  }
  const embed = record.embed || {};
  const ext = embed.external || embed.media?.external;
  if (ext?.uri) links.add(ext.uri);
  const linkTitle = ext?.title ? String(ext.title).trim() : undefined;
  const quoted = embed.record?.uri || embed.record?.record?.uri;
  return {
    text: record.text || '',
    linkTitle,
    tags: [...tags],
    links: [...links],
    langs: record.langs || [],
    createdAt: record.createdAt,
    isReply: Boolean(record.reply),
    replyParent: record.reply?.parent?.uri,
    quotedUri: quoted && quoted.includes('app.bsky.feed.post') ? quoted : undefined,
  };
}

/** From app.bsky.feed.defs#postView (searchPosts results). */
export function fromPostView(pv) {
  const handle = pv.author?.handle;
  return {
    uri: pv.uri,
    url: postUrl(pv.author.did, pv.uri, handle),
    did: pv.author.did,
    handle,
    displayName: pv.author?.displayName || undefined,
    ...fromRecord(pv.record || {}),
    counts: {
      likes: pv.likeCount ?? 0,
      reposts: pv.repostCount ?? 0,
      replies: pv.replyCount ?? 0,
      quotes: pv.quoteCount ?? 0,
    },
    source: 'search',
  };
}

/** From a Jetstream commit event (kind=commit, operation=create). */
export function fromJetstream(evt) {
  const { did } = evt;
  const { collection, rkey, record } = evt.commit;
  const uri = `at://${did}/${collection}/${rkey}`;
  return {
    uri,
    url: postUrl(did, uri),
    did,
    handle: undefined,
    displayName: undefined,
    ...fromRecord(record || {}),
    counts: undefined,
    source: 'live',
  };
}
