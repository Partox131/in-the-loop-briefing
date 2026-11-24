// Expand link shorteners (reut.rs, bit.ly, …) to the article address, so a
// Reuters or AP post joins a storyline when another outlet links the same
// article. Runs on the server only (browsers can't read redirects across
// sites). No AI, one HEAD request per short link, results kept on the post.

/** Hosts that only redirect. Outlets' own short domains are on bit.ly's service. */
export const SHORT_HOSTS = new Set([
  'reut.rs',
  'bit.ly',
  'apne.ws',
  'trib.al',
  'ow.ly',
  'buff.ly',
  'dlvr.it',
  'tinyurl.com',
  'shorturl.at',
  'cnn.it',
  'bbc.in',
  'econ.st',
  'on.ft.com',
  'nyti.ms',
  'wapo.st',
  'gu.com',
  'aje.io',
  'f24.my',
]);

export function isShortLink(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return SHORT_HOSTS.has(host);
  } catch {
    return false;
  }
}
/**
 * Follow up to `hops` redirects without downloading the page.
 * @returns {Promise<string|null>} the final address, or null if it couldn't be resolved
 */
export async function expandShortLink(url, { fetchImpl = fetch, hops = 4, timeoutMs = 10_000 } = {}) {
  let current = url;
  for (let i = 0; i < hops; i++) {
    let res;
    for (const method of ['HEAD', 'GET']) {
      try {
        res = await fetchImpl(current, { method, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
      } catch {
        res = null;
      }
      // Some shorteners refuse HEAD; try GET (the redirect body is tiny).
      if (res && res.status !== 405 && res.status !== 403) break;
    }
    if (!res) return i ? current : null;
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!location) return i ? current : null;
    current = new URL(location, current).toString();
    if (!isShortLink(current)) return current;
  }
  return isShortLink(current) ? null : current;
}
