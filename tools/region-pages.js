// Text-first pages for search engines and readers who arrive from a search:
// one per region and segment (/middle-east/, /us-politics/, …) and an About
// page (/about/). Plan: docs/research/seo.md. The live map stays the product;
// these pages are the doors into it.
//
// build-site.js writes every page without live data (the backgrounder and the
// topics only), so the pages exist even if nothing else runs. The Pages
// workflow then runs tools/make-pages.js every 15 minutes, which reads the
// server's snapshot and rewrites them with the last 24 hours. No AI: the
// summary is counts and the lead headlines of the biggest stories, as on the map.

import { isTopic, mapChildren, regionsOf } from '../src/live.js?v=6096a79e24';

export const SITE = 'https://inthelooplive.com/';

// Pages, in the order they're linked. `node` is the hierarchy node the
// summary is built for; `map` opens the live map on the same view.
export const PAGES = [
  { slug: 'middle-east', node: 'middle-east', segment: 'geopolitics', seg: '', map: 'index.html?view=middle-east', title: 'Middle East: the war with Iran, Gaza and Lebanon, live' },
  { slug: 'eastern-europe', node: 'eastern-europe', segment: 'geopolitics', seg: '', map: 'index.html?view=eastern-europe', title: "Ukraine war and NATO's eastern flank, live" },
  { slug: 'east-asia', node: 'east-asia', segment: 'geopolitics', seg: '', map: 'index.html?view=east-asia', title: 'China and Taiwan, live' },
  { slug: 'us-politics', node: 'us-politics', segment: 'us-politics', seg: 'us', map: 'index.html?segment=us', title: 'US politics today: the White House, Congress, courts and states' },
  { slug: 'canadian-politics', node: 'ca-politics', segment: 'ca-politics', seg: 'ca', map: 'index.html?segment=ca', title: 'Canadian politics today: Ottawa and the provinces' },
];

export const STATUS = { corroborated: 'Confirmed', official: 'Official', reported: 'Reported once', disputed: 'Sources disagree' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const day = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const stamp = (d) => `${d.toLocaleString('en-GB', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false })} UTC`;

/** Every page URL, for the sitemap. */
export const pageUrls = () => [...PAGES.map((p) => `${SITE}${p.slug}/`), `${SITE}about/`];

export function sitemap(now = new Date()) {
  const lastmod = now.toISOString().slice(0, 10);
  const urls = [SITE, `${SITE}briefing.html`, ...pageUrls()];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${lastmod}</lastmod></url>\n`).join('')}</urlset>\n`;
}

function shell({ path, title, description, body, jsonLd, analytics = '' }) {
  const url = `${SITE}${path}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · In the Loop</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="In the Loop">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${SITE}og-image.png">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
${analytics}<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #F5F6F8; --raise: #FFFFFF; --ink: #1D2147; --muted: #5B6080; --line: #E2E5EF; --track: #E2E5EF;
    --loop: #3047D6; --on-loop: #FFFFFF;
    --reported: #8A5608; --confirmed: #0F6B5C; --disputed: #9B2C74;
    --display: 'Bricolage Grotesque', 'Figtree', system-ui, sans-serif;
    --body: 'Figtree', system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #12142B; --raise: #1B1E3B; --ink: #E7E9F5; --muted: #A3A8C8; --line: #2C3056; --track: #2A2E52;
      --loop: #7C8FFF; --on-loop: #12142B;
      --reported: #F0C27A; --confirmed: #7FD6C2; --disputed: #F0A8D6;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 17px/1.6 var(--body); }
  a { color: var(--loop); }
  :focus-visible { outline: 3px solid var(--loop); outline-offset: 2px; border-radius: 4px; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 0 16px 64px; }
  header.top { display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: center; justify-content: space-between; padding: 18px 0; }
  .brand { display: flex; align-items: center; gap: 9px; font: 800 22px/1 var(--display); color: inherit; text-decoration: none; }
  .brand:hover { color: var(--loop); }
  .brand .dial { color: var(--ink); flex: none; }
  nav.crumbs { color: var(--muted); font-size: 15px; }
  nav.crumbs a { color: inherit; }
  h1 { font: 800 clamp(30px, 6vw, 44px)/1.1 var(--display); letter-spacing: -0.02em; margin: 16px 0 8px; }
  h2 { font: 700 24px/1.2 var(--display); margin: 40px 0 12px; }
  h3 { font: 700 19px/1.3 var(--display); margin: 28px 0 8px; }
  .kicker { color: var(--muted); font-weight: 600; margin: 0; }
  .lede { font-size: 19px; }
  .cta { display: inline-block; margin: 12px 0 4px; padding: 12px 20px; border-radius: 999px; background: var(--loop); color: var(--on-loop); font-weight: 700; text-decoration: none; }
  .card { background: var(--raise); border: 1px solid var(--line); border-radius: 14px; padding: 16px 20px; margin: 12px 0; }
  .stats { display: flex; flex-wrap: wrap; gap: 8px 24px; margin: 8px 0 0; padding: 0; list-style: none; color: var(--muted); }
  .stats b { color: var(--ink); font-size: 20px; }
  ol.stories { list-style: none; padding: 0; margin: 0; }
  ol.stories li { padding: 14px 0; border-top: 1px solid var(--line); }
  ol.stories li:first-child { border-top: 0; }
  .story { font-weight: 600; }
  .meta { color: var(--muted); font-size: 15px; }
  .st { font-weight: 700; }
  .st.corroborated, .st.official { color: var(--confirmed); }
  .st.reported { color: var(--reported); }
  .st.disputed { color: var(--disputed); }
  ul.figures { padding-left: 20px; }
  .src { color: var(--muted); font-size: 14px; }
  ul.timeline { list-style: none; padding: 0; }
  ul.timeline li { padding: 6px 0 6px 16px; border-left: 3px solid var(--track); }
  ul.timeline time { font-weight: 700; display: block; font-size: 15px; }
  ul.topics { padding-left: 20px; }
  footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 15px; }
  footer a { color: inherit; }
</style>
</head>
<body>
<div class="wrap">
<header class="top">
  <a class="brand" href="/" title="Go to the home page"><svg class="dial" width="28" height="28" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="20" fill="none" stroke="currentColor" stroke-opacity=".26" stroke-width="9"/><path d="M32 12A20 20 0 1 1 12 32" fill="none" stroke="var(--loop)" stroke-width="9" stroke-linecap="round"/><circle cx="32" cy="32" r="7" fill="currentColor"/></svg>in the loop</a>
  <nav class="crumbs" aria-label="Sections">${PAGES.map((p) => `<a href="/${p.slug}/">${esc(shortLabel(p))}</a>`).join(' · ')}</nav>
</header>
<main>
${body}
</main>
<footer>
  <p>${PAGES.map((p) => `<a href="/${p.slug}/">${esc(shortLabel(p))}</a>`).join(' · ')} · <a href="/">Live map</a> · <a href="/briefing.html">Briefing</a> · <a href="/about/">About and how it works</a></p>
  <p>In the Loop gathers what credible outlets and reporters publish and shows where each story stands. Headlines belong to the outlets that wrote them; follow the links to read them.</p>
</footer>
</div>
</body>
</html>
`;
}

function shortLabel(p) {
  return { 'middle-east': 'Middle East', 'eastern-europe': 'Ukraine and NATO east', 'east-asia': 'China and Taiwan', 'us-politics': 'US politics', 'canadian-politics': 'Canadian politics' }[p.slug] || p.slug;
}

/** The broad topics on a page's map: the region's own, or a segment's home topics plus its city region's. */
export function topicsOf(h, page) {
  const roots = page.node === page.segment ? [page.node, ...regionsOf(h, page.node)] : [page.node];
  const ids = [...new Set(roots.flatMap((r) => mapChildren(h, r).filter((id) => isTopic(h, id))))];
  return ids.map((id) => ({ id, label: h.get(id).label, about: h.get(id).about || '' }));
}

function summaryHtml(page, summary, now) {
  if (!summary) {
    return `<h2>The last 24 hours</h2>
<div class="card"><p>The latest stories, how many outlets carry each and whether they're confirmed or disputed are on the live map.</p><a class="cta" href="/${page.map}">Open the live map</a></div>`;
  }
  const stories = summary.top.length
    ? `<ol class="stories">${summary.top.map((s) => {
      const n = s.sources.length;
      const who = n === 1 ? `by ${esc(s.sources[0])}` : `${n} sources: ${esc(s.sources.slice(0, 3).join(', '))}${n > 3 ? ' and others' : ''}`;
      return `<li><a class="story" href="${esc(s.url)}" rel="nofollow noopener">${esc(s.headline)}</a>
  <div class="meta"><span class="st ${esc(s.status)}">${esc(STATUS[s.status] || 'Reported')}</span> · ${who}${s.place ? ` · ${esc(s.place.label)}` : ''} · first seen <time datetime="${esc(s.firstSeen)}">${esc(stamp(new Date(s.firstSeen)))}</time></div></li>`;
    }).join('\n')}</ol>`
    : '<p>A quiet day: no story is being carried by several outlets right now.</p>';
  return `<h2>The last 24 hours</h2>
<div class="card">
  <ul class="stats">
    <li><b>${summary.stories}</b> stories</li>
    <li><b>${summary.confirmed}</b> confirmed</li>
    <li><b>${summary.disputed}</b> disputed</li>
    <li><b>${summary.sources}</b> sources</li>
    <li><b>${summary.articles}</b> articles and <b>${summary.posts - summary.articles}</b> posts</li>
  </ul>
  <h3>Most covered</h3>
  ${stories}
  <p class="meta">Updated <time datetime="${now.toISOString()}">${esc(stamp(now))}</time>. Stories are grouped across outlets by shared links, quotes and wording; no AI.</p>
  <a class="cta" href="/${page.map}">See it all on the live map</a>
</div>`;
}

function conflictHtml(c) {
  const figures = c.figures?.length
    ? `<h3>In numbers</h3><ul class="figures">${c.figures.map((f) => `<li><b>${esc(f.value)}</b> ${esc(f.label)} <span class="src">(<a href="${esc(f.url)}" rel="nofollow noopener">${esc(f.source)}</a>, ${esc(day(f.asOf))})</span></li>`).join('')}</ul>`
    : '';
  const goals = c.goals?.length ? `<h3>What each side wants</h3><ul>${c.goals.map((g) => `<li><b>${esc(g.side)}:</b> ${esc(g.text)}</li>`).join('')}</ul>` : '';
  const timeline = c.timeline?.length
    ? `<h3>Timeline</h3><ul class="timeline">${c.timeline.map((t) => `<li><time datetime="${esc(t.date)}">${esc(day(t.date))}</time>${esc(t.text)}</li>`).join('')}</ul>`
    : '';
  return `<section>
<h2>${esc(c.title)}</h2>
${c.since ? `<p class="kicker">Since ${esc(day(c.since))}</p>` : ''}
${(c.started || []).map((p) => `<p>${esc(p)}</p>`).join('\n')}
${goals}
${c.now ? `<h3>Where it stands</h3><p>${esc(c.now)}</p>` : ''}
${figures}
${timeline}
</section>`;
}

/**
 * One region or segment page. `summary` is regionSummary()'s result, or null
 * for the build-time version. `bg` is the region's backgrounder, if any.
 */
export function renderPage({ page, h, bg = null, reviewed = null, summary = null, now = new Date(), analytics = '' }) {
  const n = h.get(page.node);
  const topics = topicsOf(h, page);
  const description = bg?.teaser
    || `${n.about || n.label} Where each story stands, how many outlets carry it, and what's confirmed or disputed, updated every 15 minutes.`;
  const intro = bg
    ? `<p class="kicker">${esc(bg.kicker)}</p><h1>${esc(bg.title)}</h1><p class="lede">${esc(bg.lede)}</p>`
    : `<p class="kicker">${esc(n.label)}</p><h1>${esc(page.title.split(':')[0])}</h1><p class="lede">${esc(n.about || '')}</p>`;
  const body = `${intro}
<a class="cta" href="/${page.map}">Open the live map</a>
${summaryHtml(page, summary, now)}
<h2>What we follow</h2>
<ul class="topics">${topics.map((t) => `<li><a href="/index.html?${page.seg ? `segment=${page.seg}&amp;` : ''}view=${esc(t.id)}"><b>${esc(t.label)}</b></a>${t.about ? `: ${esc(t.about)}` : ''}</li>`).join('')}</ul>
${(bg?.conflicts || []).map(conflictHtml).join('\n')}
${bg && reviewed ? `<p class="meta">Background written by hand and checked on ${esc(day(reviewed))}. Every figure names who counted it.</p>` : ''}`;
  const url = `${SITE}${page.slug}/`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'CollectionPage', '@id': url, url, name: page.title, description, isPartOf: { '@id': `${SITE}#website` }, ...(summary ? { dateModified: now.toISOString() } : {}) },
      { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'In the Loop', item: SITE }, { '@type': 'ListItem', position: 2, name: shortLabel(page), item: url }] },
    ],
  };
  return shell({ path: `${page.slug}/`, title: page.title, description, body, jsonLd, analytics });
}

/** The About and how it works page. `counts` are the source counts from the config files. */
export function renderAbout({ counts, analytics = '' }) {
  const body = `<h1>About In the Loop</h1>
<p class="lede">In the Loop helps you stay on top of fast-moving stories without doom-scrolling. It follows credible outlets, reporters and analysts, groups what they publish into stories, and shows where each story stands: how many independent sources carry it, whether it's confirmed or disputed, and what changed since you last looked.</p>
<a class="cta" href="/">Open the live map</a>

<h2>What we cover</h2>
<p>Three segments today: <a href="/middle-east/">geopolitics</a> (the Middle East, <a href="/eastern-europe/">Ukraine and NATO's eastern flank</a>, <a href="/east-asia/">China and Taiwan</a>), <a href="/us-politics/">US politics</a> and <a href="/canadian-politics/">Canadian politics</a> (English-language sources for now). More topics come as we add sources.</p>

<h2>Where the stories come from</h2>
<ul>
  <li><b>${counts.voices} accounts on Bluesky</b>: news outlets, reporters, analysts, officials and open-source investigators, each checked by hand. Each has a type and, for state-affiliated outlets, the state's flag.</li>
  <li><b>${counts.outlets} news outlets' RSS feeds</b>, read every 10 to 15 minutes.</li>
  <li><b>${counts.telegram} public Telegram channels</b> (armies, ministries and newsrooms), where official statements often appear first. We show their headline and a link only.</li>
</ul>
<p>We don't post, like or follow anything on any network. We only read public posts and feeds.</p>

<h2>How a story is built</h2>
<p>When several outlets report the same event, we join their posts and articles into one story, using shared links, quotes and similar wording. The headline is the first sentence of the earliest report. There is <b>no AI</b> on the site: grouping, counts and labels are rules you can read below.</p>

<h2>What the labels mean</h2>
<ul>
  <li><span class="st corroborated">Confirmed</span>: carried by at least two independent outlets or reporters.</li>
  <li><span class="st official">Official</span>: an official account (a government, army or agency) is a source.</li>
  <li><span class="st reported">Reported once</span>: one source so far. Worth watching, not yet confirmed.</li>
  <li><span class="st disputed">Sources disagree</span>: credible sources contradict each other on the facts.</li>
  <li><b>Breaking</b>: first seen less than 3 hours ago and reported by at least 3 independent outlets within 90 minutes. State media from the same country count as one outlet, and a disputed story is never breaking.</li>
</ul>

<h2>Political lean</h2>
<p>In the US and Canadian politics segments, each source carries a lean label (left, centre-left, centre, centre-right, right). These are our own first call, so you can see the mix behind a story at a glance. Bluesky leans left on North American politics, so we add right-of-centre outlets through their news feeds where we can.</p>

<h2>Background pages</h2>
<p>The region pages carry backgrounders written and checked by hand. Every figure names who counted it, the date and a link, and when sources disagree we say whose number it is.</p>
`;
  const jsonLd = { '@context': 'https://schema.org', '@type': 'AboutPage', '@id': `${SITE}about/`, url: `${SITE}about/`, name: 'About In the Loop', isPartOf: { '@id': `${SITE}#website` }, about: { '@id': `${SITE}#org` } };
  return shell({
    path: 'about/',
    title: 'About and how it works',
    description: 'How In the Loop picks its sources, groups reports into stories and decides what is confirmed, disputed or breaking. No AI.',
    body,
    jsonLd,
    analytics,
  });
}
