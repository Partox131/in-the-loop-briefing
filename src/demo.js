// Demo mode: a fake Bluesky API with made-up Iran war posts from fictional
// accounts, so the briefing page can be tried without network access.
// Everything here is illustrative sample data, not real reporting.
//
// The data goes through the real pipeline (classify, rank, storylines), so
// the demo also shows what the code does with it.

import { makeVoice } from './voices.js?v=bf4288f53c';

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
  // US politics, one per lean so the segment shows a spread.
  { handle: 'us-wire.example.com', name: 'US wire service', tier: 1, affiliation: 'US Wire', region: 'US', lean: 'centre', topics: ['us-politics'] },
  { handle: 'left-mag.example.com', name: 'Left-leaning magazine', tier: 1, affiliation: 'Left Mag', region: 'US', lean: 'left', topics: ['us-politics'] },
  { handle: 'right-paper.example.com', name: 'Right-leaning paper', tier: 1, affiliation: 'Right Paper', region: 'US', lean: 'right', topics: ['us-politics'] },
  { handle: 'court-reporter.example.com', name: 'Courts reporter', tier: 2, affiliation: 'Legal newsletter', region: 'US', lean: 'centre-left', topics: ['courts'] },
  // Canadian politics: national papers left and right of centre, and a pollster.
  { handle: 'ca-paper.example.com', name: 'Canadian national paper', tier: 1, affiliation: 'CA Paper', region: 'Canada', lean: 'centre', topics: ['ca-politics'] },
  { handle: 'ca-left.example.com', name: 'Left-leaning Canadian outlet', tier: 1, affiliation: 'CA Left', region: 'Canada', lean: 'centre-left', topics: ['ca-politics'] },
  { handle: 'ca-right.example.com', name: 'Right-leaning Canadian paper', tier: 1, affiliation: 'CA Right', region: 'Canada', lean: 'centre-right', topics: ['ca-politics'] },
  { handle: 'ca-pollster.example.com', name: 'Canadian pollster', tier: 3, affiliation: 'CA Polls', region: 'Canada', lean: 'centre', topics: ['ca-politics'] },
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
  // Three outlets within the hour: shows as breaking news in the demo.
  const tanker = 'https://wire-a.example.com/world/hormuz-tanker';
  const shutdown = 'https://us-wire.example.com/politics/stopgap-vote';
  const billC12 = 'https://ca-paper.example.com/politics/bill-c12-senate';
  return {
    'us-wire.example.com': [
      pv('us-wire.example.com', 'u1', 95, 'Senate passes stopgap spending bill, sending it to the House two days before a government shutdown deadline.', { ...o, likes: 1300, reposts: 420, link: shutdown }),
      pv('us-wire.example.com', 'u2', 260, 'Federal judge blocks the administration\'s new deportation policy nationwide, citing due process.', { ...o, likes: 900, reposts: 300 }),
      pv('us-wire.example.com', 'u3', 700, 'Governor sues over National Guard deployment to the state capital.', { ...o, likes: 400, reposts: 90 }),
      pv('us-wire.example.com', 'u4', 150, 'Justice Department sues Texas over its new congressional map, the latest redistricting fight before the midterms.', { ...o, likes: 520, reposts: 140 }),
    ],
    'left-mag.example.com': [
      pv('left-mag.example.com', 'l1', 80, 'House Democrats say they will not back the stopgap spending bill without health care money; shutdown deadline is Friday.', { ...o, likes: 800, reposts: 210 }),
      pv('left-mag.example.com', 'l3', 120, 'Texas Democrats say the Justice Department redistricting lawsuit came too late to stop the new map.', { ...o, likes: 300, reposts: 70 }),
      pv('left-mag.example.com', 'l2', 330, 'New poll: three Democrats lead early 2028 presidential primary field, none above 20%.', { ...o, likes: 500, reposts: 120 }),
    ],
    'right-paper.example.com': [
      pv('right-paper.example.com', 'r1', 70, 'Speaker Johnson says the House will vote on the Senate stopgap spending bill Thursday to avoid a shutdown.', { ...o, likes: 700, reposts: 180, link: shutdown }),
      pv('right-paper.example.com', 'r3', 180, 'Senate confirms the president\'s nominee for Fed chair after a tense confirmation hearing.', { ...o, likes: 450, reposts: 95 }),
      pv('right-paper.example.com', 'r2', 400, 'White House signs executive order on federal hiring, the third this week.', { ...o, likes: 350, reposts: 60 }),
    ],
    'ca-paper.example.com': [
      pv('ca-paper.example.com', 'k1', 60, 'Senate passes Bill C-12 at third reading with two amendments, sending it back to the House of Commons.', { ...o, likes: 600, reposts: 150, link: billC12 }),
      pv('ca-paper.example.com', 'k2', 140, 'Bank of Canada holds its policy rate, Macklem says tariffs still weigh on growth.', { ...o, likes: 420, reposts: 90 }),
      pv('ca-paper.example.com', 'k3', 300, 'Carney says Ottawa will answer new US steel tariffs with counter-tariffs if talks fail.', { ...o, likes: 900, reposts: 260 }),
      pv('ca-paper.example.com', 'k4', 520, 'Doug Ford government tables its fall economic statement at Queen\'s Park.', { ...o, likes: 200, reposts: 40 }),
    ],
    'ca-left.example.com': [
      pv('ca-left.example.com', 'm1', 90, 'Bill C-12 heads back to the Commons after the Senate amendments; the Bloc says it will oppose them.', { ...o, likes: 300, reposts: 70, link: billC12 }),
      pv('ca-left.example.com', 'm2', 360, 'Alberta independence referendum petition passes the signature threshold, Elections Alberta says.', { ...o, likes: 700, reposts: 210 }),
    ],
    'ca-right.example.com': [
      pv('ca-right.example.com', 'n1', 75, 'Poilievre presses the Liberals in question period over the Senate changes to Bill C-12.', { ...o, likes: 500, reposts: 120 }),
      pv('ca-right.example.com', 'n2', 280, 'Premiers say Ottawa must protect steel and aluminum jobs from the new US tariffs.', { ...o, likes: 400, reposts: 100 }),
    ],
    'ca-pollster.example.com': [
      pv('ca-pollster.example.com', 'q1', 200, 'New poll: Liberals 39, Conservatives 37, NDP 11. Seat projection shows a near tie.', { ...o, likes: 350, reposts: 110 }),
    ],
    'court-reporter.example.com': [
      pv('court-reporter.example.com', 'c1', 240, 'Supreme Court agrees to hear the tariffs case on an expedited schedule; oral arguments set for January.', { ...o, likes: 1100, reposts: 380 }),
      pv('court-reporter.example.com', 'c2', 200, 'The judge who blocked the deportation policy wrote that the government gave no notice. Appeals court filing expected today.', { ...o, likes: 600, reposts: 150 }),
    ],
    'wire-a.example.com': [
      pv('wire-a.example.com', 'a1', 175, 'Strikes hit a military site near Isfahan, Iran, two officials say. Developing.', { ...o, likes: 2400, reposts: 900, link: `${isfahan}?utm_source=bsky` }),
      pv('wire-a.example.com', 'a2', 120, 'Update: 12 killed in the Isfahan strikes, provincial officials say.', { ...o, likes: 1500, reposts: 600, link: isfahan }),
      pv('wire-a.example.com', 'a5', 12, 'Gaza ceasefire talks: mediators say a new proposal is under review.', { ...o, likes: 600, reposts: 150 }),
      pv('wire-a.example.com', 'a3', 600, 'Election count continues in Chile.', { ...o, likes: 300 }),
      pv('wire-a.example.com', 'a6', 55, 'Russian drones hit power stations in Kharkiv overnight, Ukraine says; parts of the city without electricity.', { ...o, likes: 700, reposts: 210 }),
      pv('wire-a.example.com', 'a7', 95, 'Taiwan reports Chinese warships and aircraft near the island as PLA drills continue.', { ...o, likes: 650, reposts: 180 }),
      pv('wire-a.example.com', 'a8', 30, "Breaking: Iran's navy seizes an oil tanker in the Strait of Hormuz, maritime security sources say.", { ...o, likes: 1300, reposts: 700, link: tanker }),
      pv('wire-a.example.com', 'a4', 300, 'Talks planned in Muscat between Iran and US envoys are postponed amid the war, mediators say.', { ...o, likes: 900, reposts: 200, link: 'https://wire-a.example.com/world/muscat-talks' }),
    ],
    'wire-b.example.com': [
      pv('wire-b.example.com', 'b1', 165, 'Iran: strikes reported on a military site outside Isfahan.', { ...o, likes: 1100, reposts: 400, link: 'https://www.wire-a.example.com/world/isfahan-strikes' }),
      pv('wire-b.example.com', 'b2', 280, 'Muscat round of talks on the Iran war delayed, not cancelled, mediators tell us.', { ...o, likes: 700, reposts: 150, link: 'https://wire-a.example.com/world/muscat-talks' }),
      pv('wire-b.example.com', 'b3', 80, 'Poland closes airspace near the border after a Russian drone incursion, NATO allies consulted.', { ...o, likes: 500, reposts: 140 }),
      pv('wire-b.example.com', 'b5', 22, 'Tanker seized by Iranian forces in the Strait of Hormuz, shipping monitor says.', { ...o, likes: 600, reposts: 250, link: tanker }),
      pv('wire-b.example.com', 'b4', 45, 'Ukraine front line: Russian forces press near Pokrovsk, Ukraine military says.', { ...o, likes: 420, reposts: 90 }),
    ],
    'gulf-outlet.example.com': [
      pv('gulf-outlet.example.com', 'g1', 40, 'A doctor at a local hospital says 30 killed in the strike near Isfahan, Iran.', { ...o, likes: 800, reposts: 350, link: isfahan }),
      pv('gulf-outlet.example.com', 'g2', 25, 'Aid trucks enter Gaza through the southern crossing for the first time in a week.', { ...o, likes: 900, reposts: 300, link: 'https://gulf-outlet.example.com/gaza-aid' }),
      pv('gulf-outlet.example.com', 'g4', 14, 'Iran seizes tanker in Hormuz; crew of 21 reported safe.', { ...o, likes: 450, reposts: 160, link: tanker }),
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
