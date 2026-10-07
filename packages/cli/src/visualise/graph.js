/*
 * The graph view's logic: what to draw around a focus, and where.
 *
 * Pure functions over the packed graph and nothing else: no document, no
 * window, no state of their own. The command writes this text into the page as
 * it is, inside the page's module script, and a test imports the same text, so
 * what is tested is what the browser runs.
 *
 * Six small pieces, each a function of the one before:
 *   createModel   adjacency, built once from the packed edges
 *   createFilter  which services, edge types and confidences are hidden
 *   neighbourhood what is drawn around a focus: hops, the cap, expansions
 *   layout        callers left, callees right, one column per hop
 *   step          where an arrow key moves from a drawn node
 *   createHistory, parseHash, formatHash   where the person has been
 * plus `search` over every node and `describe` for the details panel.
 */

/** Node fields, as packed. */
export const FIELD = Object.freeze({ type: 0, label: 1, repo: 2, kind: 3, file: 4, line: 5, meta: 6 });

/** Edge fields, as packed. */
export const EDGE = Object.freeze({ from: 0, to: 1, type: 2, confidence: 3 });

/** Row fields, as packed. */
export const ROW = Object.freeze({
  node: 0, repo: 1, file: 2, line: 3, reason: 4, level: 5, sites: 6, message: 7, hint: 8,
});

const pushTo = (map, key, value) => {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
};

const fileKey = (repo, file) => repo + ':' + file;

/**
 * Adjacency, built once.
 *
 * Edges stay where the pack put them and are named by position; each node keeps
 * the positions of the edges leaving and entering it. Rows are indexed twice:
 * by the node they name, and by the file they sit in.
 */
export const createModel = (data) => {
  const nodes = data.nodes;
  const edges = data.edges;
  const outgoing = nodes.map(() => []);
  const incoming = nodes.map(() => []);
  edges.forEach((edge, k) => {
    outgoing[edge[EDGE.from]].push(k);
    incoming[edge[EDGE.to]].push(k);
  });
  const rowsOn = new Map();
  const rowsInFile = new Map();
  (data.rows || []).forEach((row, r) => {
    if (row[ROW.node] >= 0) pushTo(rowsOn, row[ROW.node], r);
    if (row[ROW.file] >= 0) pushTo(rowsInFile, fileKey(row[ROW.repo], row[ROW.file]), r);
  });
  return { data, nodes, edges, outgoing, incoming, rowsOn, rowsInFile, haystack: null };
};

/** Nothing hidden. */
export const ALL = Object.freeze({ node: () => true, edge: () => true, active: false });

/**
 * What the person has chosen not to see, as dictionary indices.
 *
 * A filter hides; it never counts as a cut. The view says which filters are on,
 * so a node missing because of one is never mistaken for a node missing because
 * of the cap.
 */
export const createFilter = (model, hidden = {}) => {
  const services = hidden.services || new Set();
  const edgeTypes = hidden.edgeTypes || new Set();
  const confidences = hidden.confidences || new Set();
  return {
    node: (i) => !services.has(model.nodes[i][FIELD.repo]),
    edge: (k) => {
      const edge = model.edges[k];
      return !edgeTypes.has(edge[EDGE.type]) && !confidences.has(edge[EDGE.confidence]);
    },
    active: services.size + edgeTypes.size + confidences.size > 0,
  };
};

const byLabel = (model) => (a, b) => {
  const la = model.nodes[a][FIELD.label];
  const lb = model.nodes[b][FIELD.label];
  if (la !== lb) return la < lb ? -1 : 1;
  return a - b;
};

/**
 * The distinct nodes one edge away, each with the side it sits on: +1 for what
 * `u` reaches, -1 for what reaches `u`. What it reaches comes first, so a node
 * on both sides of `u` is drawn as a callee.
 */
export const neighbours = (model, filter, u, direction) => {
  const seen = new Set([u]);
  const found = [];
  const collect = (list, end, side) => {
    const here = [];
    for (const k of list) {
      const v = model.edges[k][end];
      if (seen.has(v) || !filter.edge(k) || !filter.node(v)) continue;
      seen.add(v);
      here.push(v);
    }
    here.sort(byLabel(model));
    for (const v of here) found.push({ node: v, side });
  };
  if (direction !== 'in') collect(model.outgoing[u], EDGE.to, 1);
  if (direction !== 'out') collect(model.incoming[u], EDGE.from, -1);
  return found;
};

/**
 * What is drawn around a focus.
 *
 * Breadth first, one hop at a time: the focus looks both ways, a node to its
 * right looks only further right and a node to its left only further left, so
 * a flow reads left to right. The walk keeps going past the cap without drawing
 * anything, so the number it reports as left out is the number left out (I9).
 *
 * An expanded node adds its own neighbours, both ways, up to the cap again; it
 * was asked for, so it does not compete with the hops for room.
 */
export const neighbourhood = (model, options) => {
  const focus = options.focus;
  const hops = options.hops === undefined ? 2 : options.hops;
  const cap = options.cap === undefined ? 60 : options.cap;
  const filter = options.filter || ALL;
  const expanded = options.expanded || [];

  const layer = new Map([[focus, 0]]);
  const drawn = [focus];
  const reached = new Map([[focus, 0]]);
  let frontier = [focus];
  for (let hop = 1; hop <= hops; hop += 1) {
    const next = [];
    for (const u of frontier) {
      const side = reached.get(u);
      const direction = side === 0 ? 'both' : side > 0 ? 'out' : 'in';
      for (const { node: v, side: s } of neighbours(model, filter, u, direction)) {
        if (reached.has(v)) continue;
        reached.set(v, side + s);
        next.push(v);
        if (layer.has(u) && drawn.length < cap) {
          layer.set(v, side + s);
          drawn.push(v);
        }
      }
    }
    frontier = next;
  }

  const left = new Set();
  for (const v of reached.keys()) if (!layer.has(v)) left.add(v);

  for (const u of expanded) {
    if (!layer.has(u)) continue;
    let added = 0;
    for (const { node: v, side } of neighbours(model, filter, u, 'both')) {
      if (layer.has(v)) continue;
      if (added >= cap) {
        left.add(v);
        continue;
      }
      layer.set(v, layer.get(u) + side);
      drawn.push(v);
      left.delete(v);
      added += 1;
    }
  }

  const edges = [];
  const more = new Map();
  for (const u of drawn) {
    for (const k of model.outgoing[u]) {
      const v = model.edges[k][EDGE.to];
      if (v !== u && layer.has(v) && filter.edge(k)) edges.push(k);
    }
    let hidden = 0;
    for (const { node: v } of neighbours(model, filter, u, 'both')) if (!layer.has(v)) hidden += 1;
    if (hidden > 0) more.set(u, hidden);
  }

  return { focus, hops, cap, nodes: drawn, layer, edges, more, left: left.size, reached: reached.size };
};

/**
 * Columns by hop, callers left of the focus and callees right of it.
 *
 * Within a column the order is a single barycentre sweep outward from the focus:
 * each node sits near the average row of the nodes it is joined to in the
 * columns already placed, which keeps most edges short and uncrossed without a
 * library. Ties fall to the label, so the same graph always draws the same way.
 */
export const layout = (model, hood, size = {}) => {
  const column = size.column || 240;
  const row = size.row || 52;

  const columns = new Map();
  for (const v of hood.nodes) pushTo(columns, hood.layer.get(v), v);
  const links = new Map(hood.nodes.map((v) => [v, new Set()]));
  for (const k of hood.edges) {
    const edge = model.edges[k];
    links.get(edge[EDGE.from]).add(edge[EDGE.to]);
    links.get(edge[EDGE.to]).add(edge[EDGE.from]);
  }

  const rowOf = new Map();
  const named = byLabel(model);
  const place = (at) => {
    const list = columns.get(at);
    if (list === undefined) return;
    const centre = new Map();
    for (const v of list) {
      let sum = 0;
      let count = 0;
      for (const w of links.get(v)) {
        if (!rowOf.has(w)) continue;
        sum += rowOf.get(w);
        count += 1;
      }
      centre.set(v, count === 0 ? Infinity : sum / count);
    }
    list.sort((a, b) => {
      if (a === hood.focus) return -1;
      if (b === hood.focus) return 1;
      const ca = centre.get(a);
      const cb = centre.get(b);
      if (ca !== cb) return ca < cb ? -1 : 1;
      return named(a, b);
    });
    list.forEach((v, r) => rowOf.set(v, r));
  };

  const layers = [...columns.keys()].sort((a, b) => a - b);
  const min = layers[0];
  const max = layers[layers.length - 1];
  place(0);
  for (let at = 1; at <= max; at += 1) place(at);
  for (let at = -1; at >= min; at -= 1) place(at);

  let tallest = 0;
  for (const list of columns.values()) tallest = Math.max(tallest, list.length);
  const pos = new Map();
  for (const [at, list] of columns) {
    const offset = (tallest - list.length) / 2;
    list.forEach((v, r) => {
      pos.set(v, { x: (at - min) * column, y: (offset + r) * row, layer: at, row: r });
    });
  }
  return {
    pos,
    columns,
    links,
    min,
    max,
    width: (max - min + 1) * column,
    height: tallest * row,
  };
};

/**
 * Where an arrow key goes from a drawn node.
 *
 * Up and down stay in the column. Left and right move a hop, to a node joined
 * to this one when there is one, the nearest of those by height; a column with
 * none joined still takes the nearest node in it, so the keys never trap.
 */
export const step = (placed, from, direction) => {
  const here = placed.pos.get(from);
  if (here === undefined) return from;
  if (direction === 'up' || direction === 'down') {
    const list = placed.columns.get(here.layer);
    const next = list[here.row + (direction === 'up' ? -1 : 1)];
    return next === undefined ? from : next;
  }
  const list = placed.columns.get(here.layer + (direction === 'left' ? -1 : 1));
  if (list === undefined) return from;
  const joined = list.filter((v) => placed.links.get(from).has(v));
  const pool = joined.length > 0 ? joined : list;
  let best = pool[0];
  for (const v of pool) {
    if (Math.abs(placed.pos.get(v).y - here.y) < Math.abs(placed.pos.get(best).y - here.y)) best = v;
  }
  return best;
};

const haystackOf = (model) => {
  if (model.haystack !== null) return model.haystack;
  const { types, kinds, repos, files } = model.data.dicts;
  model.haystack = model.nodes.map((node) =>
    [
      node[FIELD.label],
      types[node[FIELD.type]],
      kinds[node[FIELD.kind]] || '',
      repos[node[FIELD.repo]],
      files[node[FIELD.file]] || '',
    ]
      .join('\n')
      .toLowerCase(),
  );
  return model.haystack;
};

/**
 * Every node whose label, type, kind, service or file holds every word typed.
 *
 * A word that is exactly a node's type, kind or service names that field, so
 * `table orders` is the table called `orders`; the rest of the words are read
 * against the label. A label that is those words comes first, then one that
 * starts with them, then one that holds them all, then a match elsewhere;
 * shorter labels before longer. Returns the total as well as the first `limit`,
 * so the list can say how many it did not show.
 */
export const search = (model, query, limit = 40) => {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return { total: 0, hits: [] };
  const { types, kinds, repos } = model.data.dicts;
  const hay = haystackOf(model);
  const found = [];
  for (let i = 0; i < hay.length; i += 1) {
    if (!terms.every((term) => hay[i].includes(term))) continue;
    const node = model.nodes[i];
    const named = [types[node[FIELD.type]], kinds[node[FIELD.kind]], repos[node[FIELD.repo]]]
      .map((name) => (name || '').toLowerCase());
    const words = terms.filter((term) => !named.includes(term));
    const text = words.join(' ');
    const label = node[FIELD.label].toLowerCase();
    const rank = words.length === 0 ? 2
      : label === text ? 0
      : label.startsWith(text) ? 1
      : words.every((word) => label.includes(word)) ? 2
      : 3;
    found.push([rank, label.length, i]);
  }
  found.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return { total: found.length, hits: found.slice(0, limit).map((hit) => hit[2]) };
};

/**
 * What the details panel says about one node, unfiltered.
 *
 * Edges in and out grouped by type, the busiest group first, each group in label
 * order of the node at the far end. Rows are the ones naming this node, and
 * apart from them the ones elsewhere in its file, which the panel labels as
 * such rather than claiming they are about this node.
 */
export const describe = (model, i) => {
  const group = (list, far) => {
    const byType = new Map();
    for (const k of list) pushTo(byType, model.edges[k][EDGE.type], k);
    const named = byLabel(model);
    return [...byType]
      .map(([type, edges]) => ({
        type,
        edges: edges.sort((a, b) => named(model.edges[a][far], model.edges[b][far])),
      }))
      .sort((a, b) => b.edges.length - a.edges.length || a.type - b.type);
  };
  const node = model.nodes[i];
  const rows = model.rowsOn.get(i) || [];
  const mine = new Set(rows);
  const inFile = node[FIELD.file] >= 0
    ? (model.rowsInFile.get(fileKey(node[FIELD.repo], node[FIELD.file])) || []).filter((r) => !mine.has(r))
    : [];
  return {
    into: group(model.incoming[i], EDGE.from),
    out: group(model.outgoing[i], EDGE.to),
    rows,
    inFile,
  };
};

/**
 * Where the person has been: focuses, back and forward.
 *
 * Visiting the current focus again is not a step, and visiting anything after
 * going back drops what was ahead, as a browser does.
 */
export const createHistory = (limit = 200) => {
  const past = [];
  const ahead = [];
  let current = null;
  return {
    current: () => current,
    visit(focus) {
      if (focus === current) return;
      if (current !== null) past.push(current);
      if (past.length > limit) past.shift();
      ahead.length = 0;
      current = focus;
    },
    back() {
      if (past.length === 0) return current;
      ahead.push(current);
      current = past.pop();
      return current;
    },
    forward() {
      if (ahead.length === 0) return current;
      past.push(current);
      current = ahead.pop();
      return current;
    },
    canBack: () => past.length > 0,
    canForward: () => ahead.length > 0,
  };
};

/** Hops a view may ask for. More than three is most of any graph. */
export const HOPS = Object.freeze([1, 2, 3]);

/**
 * `#graph/<node>` or `#graph/<node>/<hops>`, or null for anything else.
 *
 * A node is its position in this page's graph, so a link names a view of this
 * page; a position past the end is refused rather than read as some other node.
 */
export const parseHash = (hash, size) => {
  const found = /^#graph\/(\d+)(?:\/(\d+))?$/.exec(hash);
  if (found === null) return null;
  const focus = Number(found[1]);
  if (focus >= size) return null;
  const hops = found[2] === undefined ? null : Number(found[2]);
  return { focus, hops: HOPS.includes(hops) ? hops : null };
};

export const formatHash = (focus, hops) => '#graph/' + focus + '/' + hops;
