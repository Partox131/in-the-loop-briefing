// Terminal rendering. Colours only when writing to a TTY and NO_COLOR is unset.

// Guarded so this module also loads in a browser (the static site).
const useColor = typeof process !== 'undefined' && process.stdout?.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const bold = c(1);
export const dim = c(2);
export const cyan = c(36);
export const yellow = c(33);
export const green = c(32);
export const magenta = c(35);

export function ago(iso, now = new Date()) {
  const s = Math.round((now - new Date(iso)) / 1000);
  if (Number.isNaN(s)) return '?';
  if (s < 60) return `${Math.max(s, 0)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function oneLine(text, max = 280) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function formatPost(p, { now } = {}) {
  const who = p.handle ? `@${p.handle}` : p.did;
  const name = p.displayName ? `${p.displayName} ` : '';
  const counts = p.counts
    ? dim(` ♥ ${p.counts.likes}  ⟳ ${p.counts.reposts}  💬 ${p.counts.replies}`)
    : '';
  const tag = p.isReply ? dim(' (reply)') : '';
  const terms = p.matchedTerms?.length ? magenta(` [${p.matchedTerms.join(', ')}]`) : '';
  return [
    `${bold(name)}${cyan(who)} ${dim('· ' + ago(p.createdAt, now))}${tag}${terms}`,
    `  ${oneLine(p.text)}`,
    `  ${dim(p.url)}${counts}`,
  ].join('\n');
}

function list(pairs) {
  return pairs.length ? pairs.map(([k, n]) => `${k} ${dim('(' + n + ')')}`).join(', ') : dim('none');
}

function sparkline(perHour) {
  if (perHour.length < 2) return '';
  const bars = '▁▂▃▄▅▆▇█';
  const max = Math.max(...perHour.map(([, n]) => n));
  return perHour.map(([, n]) => bars[Math.min(bars.length - 1, Math.floor((n / max) * (bars.length - 1)))]).join('');
}

export function formatDigest(d, { now } = {}) {
  const lines = [];
  lines.push(bold(`━━ ${d.topic} ━━`));
  if (!d.total) {
    lines.push('No matching posts in this window.');
    return lines.join('\n');
  }
  const window = d.from ? `since ${ago(d.from, now)}` : '';
  lines.push(
    `${bold(d.total)} posts ${window} · ${d.originals} original, ${d.replies} replies · ` +
      `${d.uniqueAuthors} people · ~${d.postsPerHour.toFixed(1)}/hour`,
  );
  const spark = sparkline(d.perHour);
  if (spark) lines.push(`${dim('activity (hourly, UTC):')} ${green(spark)}`);
  lines.push(`${yellow('Matched on:')} ${list(d.matchedTerms)}`);
  lines.push(`${yellow('Talking about:')} ${list(d.topWords)}`);
  lines.push(`${yellow('Hashtags:')} ${list(d.topTags)}`);
  lines.push(`${yellow('Linked sites:')} ${list(d.topDomains)}`);
  lines.push(`${yellow('Most active:')} ${list(d.topAuthors.map(([a, n]) => [a.startsWith('did:') ? a : '@' + a, n]))}`);
  if (d.mostQuoted.length) {
    lines.push(`${yellow('Being quoted a lot:')}`);
    for (const [uri, n] of d.mostQuoted) {
      const [did, , rkey] = uri.replace('at://', '').split('/');
      lines.push(`  ${n}× https://bsky.app/profile/${did}/post/${rkey}`);
    }
  }
  if (d.topPosts.length) {
    lines.push('', bold('Top posts by engagement'));
    for (const p of d.topPosts) lines.push(formatPost(p, { now }), '');
  }
  return lines.join('\n');
}
