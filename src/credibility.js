// Source credibility profiles (Amir, 26 Nov 2026; framework in the Claude Doc
// "Source credibility and event capture", summarised in
// docs/workstreams/sources.md). Each source has:
//
//   independence  who controls what it says (CLASSES below)
//   partyTo       the conflicts in which it speaks for one of the sides
//
// A source that is a party to a conflict can be first with news about it (Iran's
// state media on Hormuz shipping), but what it says about that conflict is a
// claim, not a confirmation: confirming takes a source with no stake in it.
// State media stays in every feed, labelled; nothing here hides a source.
//
// Sources are keyed by `affiliation`, the same key that already makes an
// outlet's feed, Bluesky account and Telegram channel count as one source.
// Anything not listed is independent (tier 4 accounts are official).

/** Independence classes, most independent first. `short` is the label next to the source. */
export const CLASSES = {
  independent: { label: 'Independent', short: '', note: 'Editorially independent' },
  public: { label: 'Public broadcaster', short: 'public', note: 'Public money, legal editorial independence' },
  'state-funded': { label: 'State-funded', short: 'state-funded', note: 'Government money, own newsroom, known editorial line' },
  'state-controlled': { label: 'State-controlled', short: 'state', note: 'The government or military sets the line' },
  official: { label: 'Official', short: 'official', note: 'Speaks for a government, army or institution' },
  partisan: { label: 'Partisan', short: 'partisan', note: 'Openly aligned with one side, not state-run' },
};

/**
 * Conflicts and the countries that are sides in them. A state-funded,
 * state-controlled or official source from one of these countries is a party
 * to that conflict. `nodes` are the topic-tree nodes where the conflict is
 * covered (a story under one of them, or under its children, is about it).
 */
export const CONFLICTS = {
  'iran-war': { label: 'War in Iran', parties: ['IR', 'IL', 'US'], nodes: ['iran-war', 'hormuz'] },
  'israel-gaza': { label: 'Israel and Gaza', parties: ['IL', 'PS'], nodes: ['israel-gaza'] },
  'lebanon': { label: 'Israel and Lebanon', parties: ['IL', 'LB', 'IR'], nodes: ['lebanon'] },
  'ukraine-war': { label: 'War in Ukraine', parties: ['RU', 'UA', 'BY'], nodes: ['ukraine-war'] },
  'china-taiwan': { label: 'China and Taiwan', parties: ['CN', 'TW'], nodes: ['china-taiwan'] },
  // Gulf rivalries: Qatar against Saudi Arabia, the UAE and Bahrain, and Qatar's
  // own mediation (Amir agreed for Al Jazeera, 26 Nov 2026).
  'gulf': { label: 'Gulf politics', parties: ['QA', 'SA', 'AE', 'BH'], nodes: [] },
};

/**
 * Sources that are not simply independent, by affiliation. `partyTo` lists
 * conflicts beyond those implied by the source's country (needed for partisan
 * sources, which have no state).
 */
export const SOURCE_CLASS = {
  // Iran
  'Press TV': { independence: 'state-controlled' },
  IRNA: { independence: 'state-controlled' },
  'Tehran Times': { independence: 'state-controlled' },
  // Russia
  TASS: { independence: 'state-controlled' },
  'Russian Government': { independence: 'official' },
  // China
  Xinhua: { independence: 'state-controlled' },
  CGTN: { independence: 'state-controlled' },
  'Global Times': { independence: 'state-controlled' },
  // Ukraine: Ukrinform is the state news agency.
  Ukrinform: { independence: 'state-controlled' },
  // Israel
  'Israel Defense Forces': { independence: 'official' },
  // Gulf and Turkey
  'Al Jazeera': { independence: 'state-funded' },
  'Arab News': { independence: 'state-funded' },
  'The National': { independence: 'state-funded' },
  'Anadolu Agency': { independence: 'state-funded' },
  // Western and Asian state-funded outlets
  'France 24': { independence: 'state-funded' },
  'RFE/RL': { independence: 'state-funded' },
  'Central News Agency': { independence: 'state-funded' },
  Yonhap: { independence: 'state-funded' },
  // Public broadcasters with legal editorial independence
  DW: { independence: 'public' },
  BBC: { independence: 'public' },
  'CBC News': { independence: 'public' },
  NPR: { independence: 'public' },
  PBS: { independence: 'public' },
  'ERR News': { independence: 'public' },
  LRT: { independence: 'public' },
  // Partisan, no state
  'Quds News Network': { independence: 'partisan', partyTo: ['israel-gaza'] },
};

const PARTY_CLASSES = new Set(['state-funded', 'state-controlled', 'official']);

/** The independence class of a voice (or of `{ affiliation, tier }`). */
export function independenceOf(v) {
  return SOURCE_CLASS[v?.affiliation]?.independence || (Number(v?.tier) === 4 ? 'official' : 'independent');
}

/**
 * Conflicts in which this source speaks for a side: from its country for
 * state and official sources, plus any listed in SOURCE_CLASS.
 * `country` is the state's code (voices carry it once stateCountry ran).
 */
export function partiesOf(v) {
  const out = new Set(SOURCE_CLASS[v?.affiliation]?.partyTo || []);
  const code = String(v?.country || '').toUpperCase();
  if (code && PARTY_CLASSES.has(independenceOf(v))) {
    for (const [id, c] of Object.entries(CONFLICTS)) if (c.parties.includes(code)) out.add(id);
  }
  return [...out];
}

/**
 * The conflict a topic node belongs to, or undefined. `h` is the hierarchy
 * (src/hierarchy.js); the node itself or its nearest listed ancestor counts.
 */
export function conflictOfNode(h, nodeId) {
  const byNode = new Map(Object.entries(CONFLICTS).flatMap(([id, c]) => c.nodes.map((n) => [n, id])));
  const seen = new Set();
  const queue = [nodeId];
  while (queue.length) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (byNode.has(id)) return byNode.get(id);
    const node = h?.nodes?.get(id);
    for (const p of node?.parents || []) queue.push(p);
  }
  return undefined;
}

/** One line for a "Why this source?" tooltip. */
export function credibilityNote(v) {
  const cls = CLASSES[independenceOf(v)];
  const sides = partiesOf(v).map((id) => CONFLICTS[id].label);
  return `${cls.label}: ${cls.note.toLowerCase()}.` + (sides.length ? ` Speaks for a side in: ${sides.join(', ')}.` : '');
}

/**
 * What the pages show next to a source: the short label ('state',
 * 'state-funded', 'public', 'official', 'partisan'; '' when independent) and
 * the tooltip line. Undefined for independent sources.
 */
export function credibilityTag(v) {
  const cls = independenceOf(v);
  if (cls === 'independent') return undefined;
  return { short: CLASSES[cls].short, note: credibilityNote(v) };
}

// ---------------------------------------------------------------------------
// Attribution: "Iran says…", "…: Iranian Navy", "according to TASS". An item
// that attributes what it reports to a side is a report of that side's claim,
// not a second witness (Reuters writing "Iran says" counts as Iran).

/** Names that stand for each side, by country code. */
export const SIDE_NAMES = {
  IR: ["iran(?:ian)?(?:'s)?", 'tehran', 'irgc', 'revolutionary guards?', 'tasnim', 'fars', 'irna', 'press tv', 'khamenei', 'araghchi', 'pezeshkian'],
  IL: ["israel(?:i)?(?:'s)?", 'idf', 'netanyahu', 'katz'],
  US: ['pentagon', 'centcom', 'white house', "u\\.?s\\.? (?:military|army|navy|officials?)", 'state department', 'hegseth', 'trump'],
  RU: ["russia(?:n)?(?:'s)?", 'kremlin', 'moscow', 'tass', 'ria', 'putin', 'peskov', 'lavrov', 'zakharova'],
  UA: ["ukrain(?:e|ian)(?:'s)?", 'kyiv', 'zelensk(?:y|yy|iy)', 'general staff', 'sybiha'],
  BY: ['belarus(?:ian)?', 'minsk', 'lukashenko'],
  CN: ["china(?:'s)?", 'chinese', 'beijing', 'pla', 'xinhua'],
  TW: ["taiwan(?:ese)?(?:'s)?", 'taipei', 'lai ching-te'],
  PS: ['hamas', 'gaza health ministry', 'palestinian health ministry'],
  LB: ['hezbollah', 'lebanese army'],
  QA: ['qatar(?:i)?', 'doha'],
  SA: ['saudi(?: arabia)?', 'riyadh'],
  AE: ['uae', 'emirati', 'abu dhabi'],
  BH: ['bahrain(?:i)?', 'manama'],
};

const VERB = "(?:says?|said|claims?|claimed|reports?|reported|announce[sd]?|warns?|warned|insists?|confirms?|confirmed|denies|denied|accuses?|accused|tells?|told)";
const WORDS = "(?:\\s+[\\w'’-]+){0,3}";
// Words that mark a quoted source without naming its side ("…, spokesperson
// says", "…: Army spokesman", "state media reported"). The side is then the
// one the headline names.
const SPEAKER = "(?:spokes(?:man|woman|person)|officials?|military|army|navy|guards?|ministry|commander|state (?:media|tv|television|news agency))";
const GENERIC = [
  new RegExp(`\\b${SPEAKER}${WORDS}\\s+${VERB}\\b`, 'i'), // "…, spokesperson says"
  new RegExp(`[:—–]\\s*(?:[\\w'’-]+\\s+){0,3}${SPEAKER}\\s*$`, 'i'), // "…: Army spokesman", "… — spokesperson"
  new RegExp(`\\b(?:according to|reported by|cited by) ${SPEAKER}`, 'i'),
];
// Leading words that look like "IRGC:" but are a section name ("Iran war live:").
const NOT_A_SPEAKER = /\b(?:war|live|latest|news|updates?|crisis|talks|explained|analysis|opinion|briefing)\b/i;

const ATTRIBUTION = Object.fromEntries(
  Object.entries(SIDE_NAMES).map(([code, names]) => {
    const n = `(?:${names.join('|')})`;
    return [code, {
      name: new RegExp(`\\b${n}\\b`, 'i'),
      direct: [
        new RegExp(`\\b${n}${WORDS}\\s+${VERB}\\b`, 'i'), // "Iran's army says", "IRGC Navy claims"
        new RegExp(`\\baccording to (?:the )?${n}\\b`, 'i'), // "according to TASS"
        new RegExp(`[:—–]\\s*${n}${WORDS}\\s*$`, 'i'), // "…in Hormuz: Iranian Navy"
      ],
      lead: new RegExp(`^\\W*(${n}(?:\\s+[\\w'’-]+){0,2})\\s*:`, 'i'), // "IRGC: two tankers…"
    }];
  }),
);

/** The headline of an item: its link title, else its first line or sentence. */
function firstLine(p) {
  const text = String(p?.linkTitle || p?.text || '').replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, '').trim();
  return text.split(/\n|(?<=[^A-Z.]\.)\s+(?=[A-Z“"])/)[0].trim().replace(/[.!?]+$/, '').slice(0, 240);
}

function attributes(a, line) {
  if (a.direct.some((re) => re.test(line))) return true;
  const lead = a.lead.exec(line);
  return Boolean(lead && !NOT_A_SPEAKER.test(lead[1]));
}

/**
 * The sides (country codes) an item attributes its news to, limited to the
 * given conflict's parties. Empty when it reports in its own voice.
 */
export function attributedSides(p, conflict) {
  const parties = CONFLICTS[conflict]?.parties || [];
  const line = firstLine(p);
  const direct = parties.filter((code) => ATTRIBUTION[code] && attributes(ATTRIBUTION[code], line));
  if (direct.length) return direct;
  // "…, spokesperson says": the side is the one the headline names first.
  if (!GENERIC.some((re) => re.test(line))) return [];
  const named = parties
    .map((code) => ({ code, at: ATTRIBUTION[code]?.name.exec(line)?.index ?? -1 }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at);
  return named.length ? [named[0].code] : [];
}

/**
 * Who an item counts as on a story about `conflict`:
 *   { claim: 'IR' }          a side's claim (its own media or officials, or an
 *                            outlet attributing the news to that side)
 *   { witness: '<key>' }     an independent source reporting in its own voice;
 *                            state media from one country share one key
 *   { echo: 'RU' }           state-controlled or partisan media from outside
 *                            the conflict: shows reach, never confirms
 *   {}                       neither (analysts, or no voice)
 */
export function roleOf(p, conflict) {
  const v = p.voice;
  if (!v) return {};
  if (conflict && (v.partyTo || []).includes(conflict)) return { claim: v.country || v.affiliation };
  const sides = conflict ? attributedSides(p, conflict) : [];
  if (sides.length) return { claim: sides[0] };
  // Reporters, outlets, OSINT and non-party officials can witness; analysts comment.
  if (v.tier === 3) return {};
  // State-controlled and partisan media never confirm, even about other
  // countries' wars: TASS repeating the IRGC adds reach, not proof.
  if (['state-controlled', 'partisan'].includes(v.independence || independenceOf(v))) return { echo: v.country || v.affiliation };
  return { witness: v.stateAffiliated && v.country ? `state:${v.country}` : v.affiliation };
}
