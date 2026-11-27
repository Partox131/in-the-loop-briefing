// Credible voices: outlets, beat reporters, analysts, officials and OSINT
// accounts that cover a topic. Their posts are the main signal; everyone
// else is context. See docs/design/topic-tracking.md, section 2.1.
//
// A voice file lists accounts by handle (easier to curate); at runtime we
// resolve handles to DIDs, which is what we key on (handles can change).

import { stateCountry } from './flags.js?v=9d5b4dd352';
import { credibilityTag, independenceOf, partiesOf } from './credibility.js?v=9d5b4dd352';

/** Base weight per tier. Officials and OSINT are useful but never promoted alone. */
export const TIER_WEIGHT = { 1: 1.0, 2: 0.9, 3: 0.7, 4: 0.6, 5: 0.5 };
export const TIER_NAME = { 1: 'outlet', 2: 'reporter', 3: 'analyst', 4: 'official', 5: 'OSINT' };
/** Political lean of US politics sources, left to right. */
export const LEANS = ['left', 'centre-left', 'centre', 'centre-right', 'right'];

/**
 * @typedef {Object} Voice
 * @property {string} handle
 * @property {string|undefined} did
 * @property {string} name
 * @property {1|2|3|4|5} tier
 * @property {string} affiliation   outlet or employer; two voices with the same one are not independent
 * @property {string} region        where the source is based / whose perspective it carries
 * @property {boolean} stateAffiliated
 * @property {string|undefined} country  state-affiliated only: the state's two-letter country code (its flag is shown)
 * @property {string} independence  independent, public, state-funded, state-controlled, official or partisan (src/credibility.js)
 * @property {string[]} partyTo     conflicts in which this source speaks for a side (src/credibility.js)
 * @property {string[]} topics      topic node ids this voice covers
 * @property {number} weight
 */

export function makeVoice(v) {
  if (!v.handle && !v.did) throw new Error('A voice needs a handle or a did.');
  const tier = Number(v.tier ?? 3);
  if (!TIER_WEIGHT[tier]) throw new Error(`Voice ${v.handle || v.did}: tier must be 1-5.`);
  const handle = v.handle?.replace(/^@/, '').toLowerCase();
  // A domain handle (reuters.com, name.nytimes.com) proves control of the domain.
  // Bridged accounts (*.brid.gy) mirror a website or another network: the
  // handle proves the bridge, not the outlet, so they don't count.
  const domainVerified = Boolean(handle && !handle.endsWith('.bsky.social') && !handle.endsWith('.brid.gy'));
  return {
    handle,
    did: v.did,
    name: v.name || handle,
    tier,
    affiliation: v.affiliation || v.name || handle,
    region: v.region || 'unknown',
    stateAffiliated: Boolean(v.stateAffiliated),
    // US politics: where a source sits, left to right (our call, see voices.example.json).
    ...(LEANS.includes(v.lean) ? { lean: v.lean } : {}),
    country: stateCountry(v),
    // Credibility profile (src/credibility.js): who controls the source, and
    // the conflicts in which it speaks for a side.
    independence: independenceOf({ affiliation: v.affiliation || v.name || handle, tier }),
    partyTo: partiesOf({ affiliation: v.affiliation || v.name || handle, tier, country: stateCountry(v) }),
    cred: credibilityTag({ affiliation: v.affiliation || v.name || handle, tier, country: stateCountry(v) }),
    topics: v.topics || [],
    domainVerified,
    weight: TIER_WEIGHT[tier] * (domainVerified ? 1 : 0.9),
  };
}

/**
 * Voices relevant to a node: tagged on the node itself, on an ancestor
 * (a Middle East correspondent covers the Iran war) or on a descendant
 * (an Iran specialist matters when you follow the whole Middle East).
 */
export function voicesFor(voices, hierarchy, nodeId) {
  const ids = new Set([nodeId, ...hierarchy.ancestors(nodeId), ...hierarchy.descendants(nodeId)]);
  return voices.filter((v) => v.topics.some((t) => ids.has(t)));
}

/** Fill in DIDs from handles with the AppView (getProfiles accepts handles). */
export async function resolveVoices(client, voices) {
  const need = voices.filter((v) => !v.did && v.handle).map((v) => v.handle);
  const found = new Map();
  const unchecked = new Set();
  const errors = [];
  for (let i = 0; i < need.length; i += 25) {
    const batch = need.slice(i, i + 25);
    try {
      const res = await client.query('app.bsky.actor.getProfiles', { actors: batch }, { auth: false });
      for (const p of res.profiles || []) found.set(p.handle.toLowerCase(), p);
    } catch (err) {
      batch.forEach((x) => unchecked.add(x));
      errors.push(`voice lookup failed: ${err.message}`);
    }
  }
  const resolved = [];
  const missing = [];
  for (const v of voices) {
    const p = v.did ? undefined : found.get(v.handle);
    if (v.did || p) resolved.push({ ...v, did: v.did || p.did, verified: p?.verification?.verifiedStatus === 'valid' });
    else if (!unchecked.has(v.handle)) missing.push(v.handle);
  }
  // missing = Bluesky says no such account; errors = we could not ask.
  return { voices: resolved, missing, errors };
}

/** Index by DID for quick lookups while ranking. */
export function byDid(voices) {
  return new Map(voices.filter((v) => v.did).map((v) => [v.did, v]));
}
