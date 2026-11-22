// Topic hierarchy: Politics > Geopolitics > Middle East > Iran war.
//
// Each node can have its own matching rules (include / require / exclude),
// and one or more parents (a "polyhierarchy": the Iran war also lives under
// Energy > Oil). Following a node means following it AND everything below
// it, but higher nodes use a longer time window and only surface the top few
// items per child. See docs/design/topic-tracking.md.

import { compileMatcher, compileTerm, makeTopic } from './topic.js?v=4d071d303c';

/**
 * @typedef {Object} TopicNode
 * @property {string} id
 * @property {string} label
 * @property {string[]} parents
 * @property {import('./topic.js').Topic|null} topic  own matching rules, null for pure categories
 * @property {Record<string,string[]>} lenses         lens name -> terms
 */

/** Build a hierarchy from an object shaped like topics.hierarchy.example.json. */
export function makeHierarchy(spec) {
  const nodes = new Map();
  for (const [id, n] of Object.entries(spec)) {
    const parents = n.parents ?? (n.parent ? [n.parent] : []);
    const topic = n.include?.length
      ? makeTopic({ id, label: n.label, include: n.include, exclude: n.exclude, langs: n.langs, require: n.require })
      : null;
    // place: where it sits on the live map ({ lon, lat }), for nodes tied to a place.
    // map: the live-map view a region is drawn with (src/geo.js MAP_VIEWS).
    // gate: terms a post must also contain to count anywhere under this node
    // (Geopolitics uses it so "Taiwan" film-award news stays off the map).
    const gate = n.gate?.length ? n.gate.map(compileTerm) : null;
    nodes.set(id, { id, label: n.label || id, parents, topic, gate, lenses: n.lenses || {}, place: n.place || null, map: n.map || null });
  }
  const children = new Map([...nodes.keys()].map((id) => [id, []]));
  for (const n of nodes.values()) {
    for (const p of n.parents) {
      if (!nodes.has(p)) throw new Error(`Topic "${n.id}" has unknown parent "${p}".`);
      children.get(p).push(n.id);
    }
  }

  const walk = (start, next) => {
    const out = [];
    const seen = new Set([start]);
    const stack = [...next(start)];
    while (stack.length) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      stack.push(...next(id));
    }
    return out;
  };
  const get = (id) => {
    const n = nodes.get(id);
    if (!n) throw new Error(`Unknown topic "${id}". Available: ${[...nodes.keys()].join(', ')}`);
    return n;
  };
  const descendants = (id) => (get(id), walk(id, (x) => children.get(x)));
  const ancestors = (id) => walk(id, (x) => get(x).parents);

  /** Levels below this node: 0 for a leaf topic. */
  const height = (id) => {
    const kids = children.get(id);
    return kids.length ? 1 + Math.max(...kids.map(height)) : 0;
  };

  /** One canonical path for display: first parent all the way up. */
  const path = (id) => {
    const out = [get(id).label];
    for (let n = get(id); n.parents.length; n = get(n.parents[0])) out.unshift(get(n.parents[0]).label);
    return out.join(' > ');
  };

  const matchers = new Map(
    [...nodes.values()].filter((n) => n.topic).map((n) => [n.id, compileMatcher(n.topic)]),
  );

  const gated = [...nodes.values()].filter((n) => n.gate).map((n) => n.id);
  const under = (id, top) => id === top || ancestors(id).includes(top);

  /**
   * Which nodes does this post belong to? Returns the deepest matching nodes
   * (a post about Iran strikes goes to "iran-war", not to "middle-east" too).
   *
   * With `root`, only nodes at or under `root` are returned, and a gated node
   * between them (or above `root`) must also pass its gate. A gate does not
   * apply when reading from another branch: Hormuz under Oil is not gated by
   * Geopolitics.
   */
  const classify = (post, root) => {
    const hits = new Map();
    for (const [id, m] of matchers) {
      const r = m(post);
      if (r.matched) hits.set(id, r.terms);
    }
    let out = [...hits.keys()]
      .filter((id) => !descendants(id).some((d) => hits.has(d)))
      .map((id) => ({ id, terms: hits.get(id) }));
    if (root === undefined) return out;
    out = out.filter((m) => under(m.id, root));
    const gates = gated.filter((g) => under(root, g) || under(g, root));
    if (!gates.length || !out.length) return out;
    const text = (post.text || '').toLowerCase();
    const tags = new Set((post.tags || []).map((t) => t.toLowerCase()));
    return out.filter((m) => gates.every((g) => !under(m.id, g) || get(g).gate.some((test) => test(text, tags))));
  };

  /** All include terms of a node and its descendants, for search backfill. */
  const searchTopics = (id) =>
    [id, ...descendants(id)].map((x) => get(x).topic).filter(Boolean);

  /** Breadth settings: higher nodes look further back and show fewer items per child. */
  const breadth = (id) => {
    const h = height(id);
    if (h === 0) return { halfLifeHours: 6, perChild: Infinity, total: 15 };
    if (h === 1) return { halfLifeHours: 24, perChild: 3, total: 10 };
    return { halfLifeHours: 48, perChild: 2, total: 8 };
  };

  /** Lens tags (military, diplomacy…) from the node and its ancestors' lens terms. */
  const lensesFor = (id, post) => {
    const text = (post.text || '').toLowerCase();
    const tags = new Set((post.tags || []).map((t) => t.toLowerCase()));
    const out = new Set();
    for (const nid of [id, ...ancestors(id)]) {
      for (const [lens, terms] of Object.entries(get(nid).lenses)) {
        if (terms.some((t) => compileTerm(t)(text, tags))) out.add(lens);
      }
    }
    return [...out];
  };

  return { nodes, get, children: (id) => children.get(id), descendants, ancestors, height, path, classify, searchTopics, breadth, lensesFor };
}
