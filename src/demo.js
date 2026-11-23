// Demo mode: a fake Bluesky API with made-up Iran war posts from fictional
// accounts, so the briefing page can be tried without network access.
// Everything here is illustrative sample data, not real reporting.
//
// The data goes through the real pipeline (classify, rank, storylines), so
// the demo also shows what the code does with it.

import { makeVoice } from './voices.js?v=eac1f09f7f';

const MIN = 60_000;

export const DEMO_VOICES = [
  { handle: 'wire-a.example.com', name: 'Wire service A', tier: 1, affiliation: 'Wire A', region: 'International wires', topics: ['geopolitics'] },
  { handle: 'wire-b.example.com', name: 'Wire service B', tier: 1, affiliation: 'Wire B', region: 'International wires', topics: ['geopolitics'] },
  { handle: 'gulf-outlet.example.com', name: 'Regional outlet (Qatar)', tier: 1, affiliation: 'Gulf Outlet', region: 'Gulf and Arab', topics: ['middle-east'] },
  { handle: 'israel-outlet.example.com', name: 'Israeli outlet', tier: 1, affiliation: 'Israel Outlet', region: 'Israel', topics: ['middle-east'] },
  { handle: 'tehran-reporter.example.com', name: 'Tehran correspondent', tier: 2, affiliation: 'Wire B', region: 'International wires', topics: ['iran-war'] },
  { handle: 'iran-state.example.com', name: 'Iranian state media', tier: 4, affiliation: 'Iran state media', region: 'Iran', stateAffiliated: true, topics: ['iran-war'] },
  { handle: 'defence-analyst.example.com', name: 'Defence analyst', tier: 3, affiliation: 'Think tank', region: 'US and Europe', topics: ['middle-east'] },
  { handle: 'ship-tracker.example.com', name: 'Ship-tracking analyst', tier: 5, affiliation: 'Ship tracker', region: 'US and Europe', topics: ['oil', 'hormuz'] },
].map(makeVoice);

const did = (handle) => `did:plc:demo-${handle.split('.')[0]}`;

function pv(handle, rkey, minsAgo, text, { likes = 0, reposts = 0, replies = 0, quotes = 0, link, quote, now } = {}) {
  const record = { $type: 'app.bsky.feed.post', text, createdAt: new Date(now - minsAgo * MIN).toISOString(), langs: ['en'] };
  if (link) record.embed = { $type: 'app.bsky.embed.external', external: { uri: link, title: '', description: '' } };
  if (quote) record.embed = { $type: 'app.bsky.embed.record', record: { uri: `at://${did(quote[0])}/app.bsky.feed.post/${quote[1]}` } };
  const name = DEMO_VOICES.find((v) => v.handle === handle)?.name;
  return {
    uri: `at://${did(handle)}/app.bsky.feed.post/${rkey}`,
    author: { did: did(handle), handle, displayName: name },
    record,
    likeCount: likes,
    repostCount: reposts,
    replyCount: replies,
    quoteCount: quotes,
  };
}

function demoFeeds(now) {
  const o = { now };
  const isfahan = 'https://wire-a.example.com/world/isfahan-strikes';
  return {
    'wire-a.example.com': [
      pv('wire-a.example.com', 'a1', 175, 'Strikes hit a military site near Isfahan, Iran, two officials say. Developing.', { ...o, likes: 2400, reposts: 900, link: `${isfahan}?utm_source=bsky` }),
      pv('wire-a.example.com', 'a2', 120, 'Update: 12 killed in the Isfahan strikes, provincial officials say.', { ...o, likes: 1500, reposts: 600, link: isfahan }),
      pv('wire-a.example.com', 'a5', 12, 'Gaza ceasefire talks: mediators say a new proposal is under review.', { ...o, likes: 600, reposts: 150 }),
      pv('wire-a.example.com', 'a3', 600, 'Election count continues in Chile.', { ...o, likes: 300 }),
      pv('wire-a.example.com', 'a6', 55, 'Russian drones hit power stations in Kharkiv overnight, Ukraine says; parts of the city without electricity.', { ...o, likes: 700, reposts: 210 }),
      pv('wire-a.example.com', 'a7', 95, 'Taiwan reports Chinese warships and aircraft near the island as PLA drills continue.', { ...o, likes: 650, reposts: 180 }),
      pv('wire-a.example.com', 'a4', 300, 'Talks planned in Muscat between Iran and US envoys are postponed amid the war, mediators say.', { ...o, likes: 900, reposts: 200, link: 'https://wire-a.example.com/world/muscat-talks' }),
    ],
    'wire-b.example.com': [
      pv('wire-b.example.com', 'b1', 165, 'Iran: strikes reported on a military site outside Isfahan.', { ...o, likes: 1100, reposts: 400, link: 'https://www.wire-a.example.com/world/isfahan-strikes' }),
      pv('wire-b.example.com', 'b2', 280, 'Muscat round of talks on the Iran war delayed, not cancelled, mediators tell us.', { ...o, likes: 700, reposts: 150, link: 'https://wire-a.example.com/world/muscat-talks' }),
      pv('wire-b.example.com', 'b3', 80, 'Poland closes airspace near the border after a Russian drone incursion, NATO allies consulted.', { ...o, likes: 500, reposts: 140 }),
      pv('wire-b.example.com', 'b4', 45, 'Ukraine front line: Russian forces press near Pokrovsk, Ukraine military says.', { ...o, likes: 420, reposts: 90 }),
    ],
    'gulf-outlet.example.com': [
      pv('gulf-outlet.example.com', 'g1', 40, 'A doctor at a local hospital says 30 killed in the strike near Isfahan, Iran.', { ...o, likes: 800, reposts: 350, link: isfahan }),
      pv('gulf-outlet.example.com', 'g2', 25, 'Aid trucks enter Gaza through the southern crossing for the first time in a week.', { ...o, likes: 900, reposts: 300, link: 'https://gulf-outlet.example.com/gaza-aid' }),
      pv('gulf-outlet.example.com', 'g3', 70, 'Houthis say they targeted a ship in the Red Sea; no confirmation from the shipping company.', { ...o, likes: 300, reposts: 80 }),
    ],
    'israel-outlet.example.com': [
      pv('israel-outlet.example.com', 'i2', 18, 'Gaza: first aid convoy in a week crosses in the south, officials confirm.', { ...o, likes: 500, reposts: 120, link: 'https://gulf-outlet.example.com/gaza-aid' }),
      pv('israel-outlet.example.com', 'i3', 50, 'Hezbollah drone intercepted over the Lebanon border, the army says.', { ...o, likes: 350, reposts: 60 }),
      pv('israel-outlet.example.com', 'i1', 260, 'Muscat talks with Iran postponed; Israeli officials decline to comment on the war.', { ...o, likes: 400, link: 'https://wire-a.example.com/world/muscat-talks' }),
    ],
    'tehran-reporter.example.com': [
      pv('tehran-reporter.example.com', 't1', 150, 'Phones are patchy in Isfahan. Residents describe three blasts after the strike, then quiet. Iran has not confirmed the target.', { ...o, likes: 1900, reposts: 500, quotes: 40, link: isfahan }),
      pv('tehran-reporter.example.com', 't2', 900, 'Quiet day in Tehran markets.', { ...o, likes: 30 }),
    ],
    'iran-state.example.com': [
      pv('iran-state.example.com', 's1', 140, 'Iran air defences successfully confronted hostile targets over Isfahan after the attack.', { ...o, likes: 200, reposts: 90 }),
    ],
    'defence-analyst.example.com': [
      pv('defence-analyst.example.com', 'd1', 100, 'Satellite images of Isfahan will settle this. Early interception claims after a strike are usually high.', { ...o, likes: 650, reposts: 120, quote: ['iran-state.example.com', 's1'] }),
    ],
    'ship-tracker.example.com': [
      pv('ship-tracker.example.com', 'x1', 35, 'Two tankers diverting away from the Strait of Hormuz in the last hour amid the Iran war. No explanation yet. #OOTT', { ...o, likes: 300, reposts: 140 }),
    ],
  };
}

/** A fetch() that answers the few Bluesky endpoints the brief uses. */
export function demoFetch({ now = Date.now() } = {}) {
  const feeds = demoFeeds(now);
  const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  return async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith('app.bsky.actor.getProfiles')) {
      const profiles = u.searchParams
        .getAll('actors')
        .filter((a) => feeds[a])
        .map((handle) => ({ did: did(handle), handle, verification: { verifiedStatus: 'none' } }));
      return json({ profiles });
    }
    if (u.pathname.endsWith('app.bsky.feed.getAuthorFeed')) {
      const actor = u.searchParams.get('actor');
      const handle = Object.keys(feeds).find((h) => did(h) === actor || h === actor);
      return json({ feed: (feeds[handle] || []).map((post) => ({ post })) });
    }
    if (u.pathname.endsWith('app.bsky.feed.searchPosts')) return json({ posts: [] });
    return new Response('not in demo', { status: 404 });
  };
}
