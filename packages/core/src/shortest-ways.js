/*
 * The shortest ways from one node to another (P229).
 *
 * Plain JavaScript, like prompt-text.js, because the page runs it as it is:
 * the page's path finder, `flowatlas path` and `get_flow` with `to` all ask
 * this one function, so a path found in one is the path found in the others.
 * It knows nothing about a graph's storage. The caller says how to move from a
 * node (`moves`) and how two nodes are ordered for a person (`named`); a node
 * and an edge are whatever keys the caller uses, an index on the page and an
 * id in a database.
 */

/** Depths a search may be asked to look along, the next tried when the last found nothing. */
export const PATH_DEPTHS = Object.freeze([6, 12, 24]);

/** How far a search looks when nobody says. */
export const DEFAULT_PATH_DEPTH = 12;

/** How many nodes on a shortest path are kept when nobody says. */
export const DEFAULT_PATH_CAP = 60;

/**
 * The shortest ways from `from` to `to`.
 *
 * `moves(u, forward)` lists `[v, edge]` for the nodes one step from `u`:
 * forward along the edges the way they run, or backward against them. An
 * undirected search is the caller's `moves` answering both ways for either.
 * Breadth first from `from`, at most `depth` steps; then back from `to`, so
 * the nodes on some shortest path are exactly those whose distances from both
 * ends add up to its length.
 *
 * Every node on some shortest path is kept, nearest `from` first and then by
 * `named`, up to `cap`. Past the cap one whole path is kept first - the first
 * by `named` at every step - so a cut never leaves a gap. `paths` counts the
 * shortest paths there are, `left` the nodes on them that were not kept.
 *
 * With none within `depth` steps, `found` is false and `searched` says how
 * many nodes were reached looking, so "no path" reads as "none within what
 * was searched".
 */
export const shortestWays = (options) => {
  const from = options.from;
  const to = options.to;
  const moves = options.moves;
  const named = options.named;
  const depth = options.depth === undefined ? DEFAULT_PATH_DEPTH : options.depth;
  const cap = options.cap === undefined ? DEFAULT_PATH_CAP : options.cap;

  const spread = (start, forward, limit, stopAt, hasStop) => {
    const dist = new Map([[start, 0]]);
    let frontier = [start];
    for (let d = 1; d <= limit && frontier.length > 0 && !(hasStop && dist.has(stopAt)); d += 1) {
      const next = [];
      for (const u of frontier) {
        for (const [v] of moves(u, forward)) {
          if (dist.has(v)) continue;
          dist.set(v, d);
          next.push(v);
        }
      }
      frontier = next;
    }
    return dist;
  };

  const ahead = spread(from, true, depth, to, true);
  if (!ahead.has(to)) {
    return {
      found: false,
      length: null,
      paths: 0,
      searched: ahead.size,
      depth,
      onPath: [],
      kept: [],
      layer: new Map(),
      edges: [],
      steps: [],
      parent: new Map(),
      left: 0,
    };
  }

  const length = ahead.get(to);
  const behind = spread(to, false, length, undefined, false);
  const on = (v) => ahead.has(v) && behind.has(v) && ahead.get(v) + behind.get(v) === length;
  const onPath = [...ahead.keys()].filter(on).sort((a, b) => ahead.get(a) - ahead.get(b) || named(a, b));

  // The steps along a shortest path, and the next nodes each node leads to.
  const steps = [];
  const next = new Map(onPath.map((v) => [v, new Set()]));
  for (const u of onPath) {
    for (const [v, edge] of moves(u, true)) {
      if (on(v) && ahead.get(v) === ahead.get(u) + 1) {
        steps.push({ from: u, to: v, edge });
        next.get(u).add(v);
      }
    }
  }
  const ways = new Map([[from, 1]]);
  for (const u of onPath) for (const v of next.get(u)) ways.set(v, (ways.get(v) || 0) + (ways.get(u) || 0));

  const kept = [];
  if (onPath.length > cap) {
    // One whole path first, the first by name at every step.
    for (let u = from; u !== undefined; u = [...next.get(u)].sort(named)[0]) kept.push(u);
  }
  const placed = new Set(kept);
  for (const v of onPath) {
    if (kept.length >= cap) break;
    if (!placed.has(v)) {
      placed.add(v);
      kept.push(v);
    }
  }
  // Each kept node was reached from the first kept node, by name, a step
  // before it, so one whole way back to the start can always be read off.
  const parent = new Map();
  for (const u of kept) {
    for (const v of next.get(u)) {
      if (placed.has(v) && (!parent.has(v) || named(u, parent.get(v)) < 0)) parent.set(v, u);
    }
  }
  const keptSteps = steps.filter((step) => placed.has(step.from) && placed.has(step.to));
  return {
    found: true,
    length,
    paths: from === to ? 1 : ways.get(to) || 0,
    searched: ahead.size,
    depth,
    onPath,
    kept,
    layer: new Map(kept.map((v) => [v, ahead.get(v)])),
    edges: [...new Set(keptSteps.map((step) => step.edge))],
    steps: keptSteps,
    parent,
    left: onPath.length - kept.length,
  };
};
