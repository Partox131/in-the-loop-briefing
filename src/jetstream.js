// Live feed of every new public Bluesky post via Jetstream.
//
// Jetstream is a Bluesky-run service that turns the raw AT Protocol firehose
// (binary CBOR/CAR) into simple JSON over a WebSocket. We subscribe only to
// app.bsky.feed.post records and do the topic matching ourselves, because
// Jetstream can filter by collection and by author DID, but not by keyword.
//
// Each event carries time_us (microseconds). Passing it back as ?cursor= on
// reconnect resumes without gaps, and a cursor in the recent past replays
// the last few minutes/hours (Jetstream keeps a rolling buffer).

import { fromJetstream } from './normalize.js?v=708ab11dd4';

export const JETSTREAM_HOSTS = [
  'jetstream2.us-east.bsky.network',
  'jetstream1.us-east.bsky.network',
  'jetstream1.us-west.bsky.network',
  'jetstream2.us-west.bsky.network',
];

export function jetstreamUrl(host, { cursorUs, dids } = {}) {
  const qs = new URLSearchParams({ wantedCollections: 'app.bsky.feed.post' });
  // Only these accounts (e.g. a topic's credible voices). Jetstream allows up to 10,000.
  for (const d of dids || []) qs.append('wantedDids', d);
  if (cursorUs) qs.set('cursor', String(cursorUs));
  return `wss://${host}/subscribe?${qs}`;
}

/**
 * Subscribe to new posts. Calls onPost(post, timeUs) for every created post.
 * Reconnects with backoff and rotates hosts. Returns { close() }.
 */
export function subscribePosts({ onPost, onStatus = () => {}, cursorUs, dids, WebSocketImpl = globalThis.WebSocket }) {
  if (dids && dids.length > 10_000) throw new Error('Jetstream allows at most 10,000 DIDs per connection.');
  if (!WebSocketImpl) throw new Error('This Node.js has no global WebSocket. Use Node 22 or newer.');
  let lastUs = cursorUs;
  let hostIdx = 0;
  let attempt = 0;
  let ws;
  let closed = false;
  let timer;

  const connect = () => {
    const host = JETSTREAM_HOSTS[hostIdx % JETSTREAM_HOSTS.length];
    onStatus({ type: 'connecting', host });
    ws = new WebSocketImpl(jetstreamUrl(host, { cursorUs: lastUs, dids }));
    ws.onopen = () => {
      attempt = 0;
      onStatus({ type: 'open', host });
    };
    ws.onmessage = (msg) => {
      let evt;
      try {
        evt = JSON.parse(typeof msg.data === 'string' ? msg.data : msg.data.toString());
      } catch {
        return;
      }
      if (evt.time_us) lastUs = evt.time_us;
      if (evt.kind !== 'commit' || evt.commit?.operation !== 'create') return;
      if (evt.commit.collection !== 'app.bsky.feed.post') return;
      onPost(fromJetstream(evt), evt.time_us);
    };
    ws.onerror = (e) => onStatus({ type: 'error', host, error: e?.message || 'websocket error' });
    ws.onclose = () => {
      if (closed) return;
      attempt++;
      hostIdx++;
      const wait = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
      onStatus({ type: 'reconnecting', inMs: wait });
      timer = setTimeout(connect, wait);
    };
  };

  connect();
  return {
    close() {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    },
    get cursorUs() {
      return lastUs;
    },
  };
}
