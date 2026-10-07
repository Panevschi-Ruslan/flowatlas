/*
 * The graph view's logic: what to draw around a focus, and where.
 *
 * Pure functions over the packed graph and nothing else: no document, no
 * window, no state of their own. The command writes this text into the page as
 * it is, inside the page's module script, and a test imports the same text, so
 * what is tested is what the browser runs.
 *
 * Small pieces, each a function of the one before:
 *   createModel   adjacency, built once from the packed edges
 *   createFilter  which services, edge types and confidences are hidden
 *   foldPlumbing  guards, interceptors, pipes and middleware as a chip
 *   neighbourhood what is drawn around a focus: the walk, busy sides as
 *                 groups, the cap, expansions
 *   trace         the way from the focus to a drawn unit
 *   layout        callers left, callees right, one column per hop, one band
 *                 per service
 *   step          where an arrow key moves from a drawn node
 *   createHistory where the person has been; the address is frame.js's
 * plus `search` over every node, `describe` for the details panel, and
 * `labelParts`, `middle` and `zoomLevel` for how a node is written.
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
  return { data, nodes, edges, outgoing, incoming, rowsOn, rowsInFile, haystack: null, owners: null };
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

/* ── what a drawing folds and groups, before anything is placed ── */

/** What runs in front of a way in, in the order a framework runs it. */
export const PLUMBING = Object.freeze(['middleware', 'guard', 'interceptor', 'pipe']);

/** A label written `Class.method`. */
const MEMBER = /^([A-Za-z_$][\w$]*)\.([\w$#]+)$/;

const dictIndex = (list, name) => list.indexOf(name);

/**
 * The class a node belongs to, for grouping and for its second line.
 *
 * A method says it in its label. A query, a publisher or a call made in code is
 * made from a method, and a way in or an action hands over to one, so those
 * take the class of the method they are joined to. Anything else is known by
 * its file. Worked out once per node and kept, like the search haystack.
 */
export const ownerOf = (model, i) => {
  if (model.owners === null) model.owners = new Map();
  const known = model.owners.get(i);
  if (known !== undefined) return known;
  const { edgeTypes, files } = model.data.dicts;
  const calls = dictIndex(edgeTypes, 'calls');
  const handles = dictIndex(edgeTypes, 'handles');
  const classOf = (v) => {
    const found = MEMBER.exec(model.nodes[v][FIELD.label]);
    return found === null ? null : found[1];
  };
  let owner = classOf(i);
  if (owner === null) {
    for (const k of model.incoming[i]) {
      if (model.edges[k][EDGE.type] !== calls) continue;
      owner = classOf(model.edges[k][EDGE.from]);
      if (owner !== null) break;
    }
  }
  if (owner === null) {
    for (const k of model.outgoing[i]) {
      if (model.edges[k][EDGE.type] !== handles) continue;
      owner = classOf(model.edges[k][EDGE.to]);
      if (owner !== null) break;
    }
  }
  if (owner === null) owner = (files[model.nodes[i][FIELD.file]] || '').split('/').pop();
  model.owners.set(i, owner);
  return owner;
};

/**
 * Things named by themselves, never by a class: what a flow ends at, and the
 * classes and containers that are the owner rather than owned.
 */
const SELF_NAMED = new Set([
  'table', 'channel', 'external_api', 'config_key',
  'provider', 'guard', 'interceptor', 'pipe', 'middleware', 'module', 'ui_component', 'repo', 'service',
]);

/**
 * The two lines a node is drawn with: what it is, strong, and whose it is,
 * muted. `OrdersService.list` is `list` of `OrdersService`; a route is its
 * address, of the class that handles it; a table is its name, of its kind.
 */
export const labelParts = (model, i) => {
  const node = model.nodes[i];
  const label = node[FIELD.label];
  const type = model.data.dicts.types[node[FIELD.type]];
  const kind = model.data.dicts.kinds[node[FIELD.kind]] || '';
  if (SELF_NAMED.has(type)) return { name: label, owner: kind ? kind + ' ' + type : type };
  const member = MEMBER.exec(label);
  if (member !== null) return { name: member[2], owner: member[1] };
  const owner = ownerOf(model, i);
  return { name: label, owner: owner === label ? kind || type : owner };
};

/**
 * Text cut in the middle, so both ends survive: a path keeps its verb and its
 * last segment, a file its folder and its name.
 */
export const middle = (text, chars) => {
  if (text.length <= chars) return text;
  if (chars <= 1) return '…';
  const head = Math.ceil((chars - 1) / 2);
  const tail = chars - 1 - head;
  return text.slice(0, head) + '…' + (tail > 0 ? text.slice(text.length - tail) : '');
};

/**
 * Plumbing folded onto what it wraps.
 *
 * A `guarded_by` edge is not walked: what it reaches is counted on the node it
 * leaves, as a chip, so a route reads as one node and not as a route lost among
 * its guards. Three things put the edge back: `draw`, which walks them all; a
 * node in `unfolded`, whose own chain is drawn beside it; and a focus that is
 * itself plumbing, since then what it wraps is the question.
 */
export const foldPlumbing = (model, options = {}) => {
  const { types, edgeTypes } = model.data.dicts;
  const focus = options.focus;
  const draw = options.draw === true;
  const unfolded = options.unfolded || new Set();
  const base = options.filter || ALL;
  const wraps = dictIndex(edgeTypes, 'guarded_by');
  const layers = new Map(PLUMBING.map((name) => [dictIndex(types, name), name]));
  const isWrap = (k) => model.edges[k][EDGE.type] === wraps;
  const walk = (k) => draw || !isWrap(k) || model.edges[k][EDGE.to] === focus;
  const chip = (v) => {
    if (draw) return null;
    const counts = new Map();
    for (const k of model.outgoing[v]) {
      const to = model.edges[k][EDGE.to];
      if (!isWrap(k) || to === focus || !base.edge(k) || !base.node(to)) continue;
      const layer = layers.get(model.nodes[to][FIELD.type]) || 'wrapper';
      counts.set(layer, (counts.get(layer) || 0) + 1);
    }
    if (counts.size === 0) return null;
    const order = [...PLUMBING, 'wrapper'];
    const list = [...counts].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
    return { open: unfolded.has(v), layers: list, total: list.reduce((sum, [, n]) => sum + n, 0) };
  };
  return {
    unfolded,
    walk,
    /** An edge drawn between two drawn nodes: walked, or part of a chain asked for. */
    edge: (k) => walk(k) || unfolded.has(model.edges[k][EDGE.from]),
    /** The edges of `v`'s own chain, when it is unfolded. */
    chain: (v) => model.outgoing[v].filter((k) => isWrap(k) && base.edge(k) && base.node(model.edges[k][EDGE.to])),
    chip,
  };
};

/** When a side of a node is busy enough to group, and how much of it a group shows at once. */
export const GROUPING = Object.freeze({ at: 6, page: 8 });

/**
 * Busy neighbours as groups, before anything is counted against the cap.
 *
 * Neighbours on one side of one node, of one type, are a bucket; a bucket
 * bigger than `at` becomes groups by service, then by owning class, each with a
 * count. A level with more than `page` groups shows the busiest `page - 1` and
 * one more group holding the rest, which opens into the next page the same way.
 * A group of one is its node.
 *
 * Ids are paths, so a group keeps its id across redraws and `opened` can name
 * it: an opened group is replaced, in place, by what it holds.
 */
const grouper = (model, grouping, opened, made) => {
  const repoOf = (v) => model.nodes[v][FIELD.repo];
  const named = byLabel(model);

  const partition = (members, keyOf) => {
    const parts = new Map();
    for (const v of members) pushTo(parts, keyOf(v), v);
    return [...parts].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  };

  const make = (key, level, members, meta) => {
    const id = key;
    const group = {
      id,
      level,
      type: model.nodes[members[0]][FIELD.type],
      repo: members.every((v) => repoOf(v) === repoOf(members[0])) ? repoOf(members[0]) : -1,
      owner: null,
      parts: 1,
      members,
      ...meta,
    };
    made.set(id, group);
    return opened.has(id) ? split(group.members, group.next, id) : [id];
  };

  /* One level: parts become groups, a part of one stays its node, and a long
     list of parts keeps its busiest and gathers the rest. */
  const level = (at, key, parts, groupOf) => {
    const units = [];
    const shown = parts.length > grouping.page ? parts.slice(0, grouping.page - 1) : parts;
    for (const [name, part] of shown) units.push(...(part.length === 1 ? part : groupOf(name, part)));
    if (shown.length < parts.length) {
      const rest = parts.slice(shown.length);
      units.push(...make(key + '/+', 'rest', rest.flatMap(([, part]) => part), {
        parts: rest.length,
        next: at,
      }));
    }
    return units;
  };

  const byClass = (key) => (owner, part) =>
    make(key + '/c:' + owner, 'class', part, { owner, next: 'leaf' });

  const byService = (key) => (repo, part) => {
    const owners = new Set(part.map((v) => ownerOf(model, v)));
    // A service whose part is one class is that class: one click, not two.
    if (owners.size === 1) return byClass(key + '/s:' + repo)([...owners][0], part);
    return make(key + '/s:' + repo, 'service', part, { parts: owners.size, next: 'class' });
  };

  const split = (members, at, key) => {
    if (at === 'leaf' || members.length <= grouping.at) return [...members].sort(named);
    if (at === 'service') {
      const parts = partition(members, repoOf);
      if (parts.length > 1) return level('service', key, parts, byService(key));
    }
    const parts = partition(members, (v) => ownerOf(model, v));
    if (parts.length === 1) return byClass(key)(parts[0][0], members);
    return level('class', key, parts, byClass(key));
  };

  /* The neighbours one node found, in the order found: a bucket that groups is
     drawn where its first member would have been. */
  return (found, key) => {
    const buckets = new Map();
    for (const f of found) pushTo(buckets, f.side + ':' + model.nodes[f.node][FIELD.type], f.node);
    const units = [];
    const done = new Set();
    for (const f of found) {
      const bucket = f.side + ':' + model.nodes[f.node][FIELD.type];
      const members = buckets.get(bucket);
      if (members.length <= grouping.at) {
        units.push(f);
        continue;
      }
      if (done.has(bucket)) continue;
      done.add(bucket);
      const at = 'g:' + key + (f.side > 0 ? '>' : '<') + model.nodes[f.node][FIELD.type];
      for (const id of split(members, 'service', at)) units.push({ node: id, side: f.side });
    }
    return units;
  };
};

/**
 * Which way a drawn node looks, by the side of the focus it is drawn on.
 *
 * The flow goes on outward: the focus looks both ways, a node to its right only
 * further right and a node to its left only further left, so a flow reads left
 * to right. The other way from a node is who else uses it - the other callers
 * of a helper the flow calls, the other callees of a caller - which is context,
 * drawn only when asked for and marked as such. The walk, an expansion and
 * "who else" all read this one table.
 */
export const LOOK = Object.freeze({
  [-1]: Object.freeze({ flow: 'in', also: 'out' }),
  0: Object.freeze({ flow: 'both', also: null }),
  1: Object.freeze({ flow: 'out', also: 'in' }),
});

/**
 * Everything within the hops, uncapped, as a tree of who reached whom first.
 *
 * Breadth first, one hop at a time, each node looking the way `LOOK` says.
 */
const walkFrom = (model, filter, focus, hops) => {
  const layer = new Map([[focus, 0]]);
  const kids = new Map();
  let frontier = [focus];
  for (let hop = 1; hop <= hops; hop += 1) {
    const next = [];
    for (const u of frontier) {
      const side = layer.get(u);
      for (const found of neighbours(model, filter, u, LOOK[Math.sign(side)].flow)) {
        if (layer.has(found.node)) continue;
        layer.set(found.node, side + found.side);
        pushTo(kids, u, found);
        next.push(found.node);
      }
    }
    frontier = next;
  }
  return { layer, kids };
};

/**
 * What is drawn around a focus.
 *
 * Four steps, each a function of the one before: walk everything within the
 * hops; fold plumbing and group busy sides into units; take units breadth first
 * until the cap; add what was asked for on top. A group is one unit, so a table
 * with two hundred queries costs the cap a handful of groups, not two hundred
 * nodes. The walk goes past the cap without drawing anything, so the number it
 * reports as left out is the number left out (I9).
 *
 * An expanded node adds its own neighbours the way it looks (`LOOK`) - the
 * focus both ways, a node on either side further out - up to the cap again; an
 * unfolded node adds its plumbing. A node in `also` adds who else uses it, the
 * other way, grouped as busy sides are and marked in `context` with the node
 * they are about, so the drawing can set them apart from the flow. All three
 * were asked for, so none competes with the hops for room.
 *
 * Folding and grouping are off unless asked for (`fold`, `group`), which
 * leaves the plain neighbourhood: every unit a node.
 *
 * Units are node positions, or group ids (strings) when grouping is on.
 * `parent` names the unit each unit was reached from, so the way from the focus
 * to anything drawn can be read back (`trace`). `bundles` are the edges into
 * and out of groups, gathered per pair of units; `behind` counts what lies past
 * a closed group, which is not drawn and is not cut either. `side` is the side
 * of the focus each unit is drawn on, -1, 0 or 1. `more` counts what an
 * expansion would add; `others` counts who else uses a node, outside the flow,
 * and says whether it is drawn, so neither number passes for the other (I9).
 */
export const neighbourhood = (model, options) => {
  const focus = options.focus;
  const hops = options.hops === undefined ? 2 : options.hops;
  const cap = options.cap === undefined ? 60 : options.cap;
  const base = options.filter || ALL;
  const expanded = options.expanded || [];
  const also = options.also || [];
  const fold = options.fold ? foldPlumbing(model, { ...options.fold, focus, filter: base }) : null;
  const filter = fold === null ? base : { ...base, edge: (k) => base.edge(k) && fold.walk(k) };
  const groups = new Map();
  const unitsOf = options.group
    ? grouper(model, { ...GROUPING, ...(options.group === true ? {} : options.group) }, options.opened || new Set(), groups)
    : (found) => found;

  const tree = walkFrom(model, filter, focus, hops);

  const layer = new Map([[focus, 0]]);
  const sideOf = new Map([[focus, 0]]);
  const context = new Map();
  const parent = new Map();
  const drawn = [focus];
  const memberOf = new Map();
  const shown = [];
  const represented = (v) => layer.has(v) || memberOf.has(v);
  const unitOf = (v) => (layer.has(v) ? v : memberOf.get(v));
  const inFlow = (v) => represented(v) && !context.has(unitOf(v));
  const place = (id, from, side, about = null) => {
    layer.set(id, layer.get(from) + side);
    sideOf.set(id, from === focus ? side : sideOf.get(from));
    if (about !== null) context.set(id, about);
    parent.set(id, from);
    drawn.push(id);
    if (typeof id === 'number') return;
    const group = groups.get(id);
    group.side = side;
    for (const v of group.members) memberOf.set(v, id);
    shown.push(group);
  };

  const queue = [focus];
  for (let head = 0; head < queue.length; head += 1) {
    const u = queue[head];
    for (const { node: id, side } of unitsOf(tree.kids.get(u) || [], String(u))) {
      if (drawn.length >= cap) continue;
      place(id, u, side);
      if (typeof id === 'number') queue.push(id);
    }
  }

  // What was asked for around a drawn node, grouped, up to the cap again.
  const asked = new Set();
  const around = (u, direction, key, about) => {
    const fresh = neighbours(model, filter, u, direction).filter((f) => !represented(f.node));
    let added = 0;
    for (const { node: id, side } of unitsOf(fresh, key)) {
      for (const v of typeof id === 'number' ? [id] : groups.get(id).members) asked.add(v);
      if (added >= cap) continue;
      place(id, u, side, about);
      added += 1;
    }
  };
  // Context is not flow: it neither expands nor has anyone else.
  const lookOf = (u) => (typeof u === 'number' && layer.has(u) && !context.has(u) ? LOOK[sideOf.get(u)] : null);
  for (const u of expanded) {
    const look = lookOf(u);
    if (look !== null) around(u, look.flow, 'x' + u, null);
  }
  for (const u of also) {
    const look = lookOf(u);
    if (look !== null && look.also !== null) around(u, look.also, 'o' + u, { of: u, look: look.also });
  }

  if (fold !== null) {
    for (const u of fold.unfolded) {
      if (!layer.has(u)) continue;
      for (const k of fold.chain(u)) {
        const v = model.edges[k][EDGE.to];
        if (!represented(v)) place(v, u, 1, context.get(u) || null);
      }
    }
  }

  // Past a closed group: reached, not drawn, and not cut by the cap either.
  const behindOf = new Set();
  for (const group of shown) {
    let count = 0;
    const stack = group.members.flatMap((v) => tree.kids.get(v) || []);
    while (stack.length > 0) {
      const { node: v } = stack.pop();
      if (represented(v) || behindOf.has(v)) continue;
      behindOf.add(v);
      count += 1;
      stack.push(...(tree.kids.get(v) || []));
    }
    group.behind = count;
  }

  const left = new Set();
  for (const v of [...tree.layer.keys(), ...asked]) {
    if (!represented(v) && !behindOf.has(v)) left.add(v);
  }

  const drawEdge = fold === null ? filter.edge : (k) => base.edge(k) && fold.edge(k);
  const edges = [];
  const bundles = new Map();
  for (const u of [...drawn.filter((id) => typeof id === 'number'), ...memberOf.keys()]) {
    for (const k of model.outgoing[u]) {
      const v = model.edges[k][EDGE.to];
      const a = unitOf(u);
      const b = unitOf(v);
      if (v === u || b === undefined || a === b || !drawEdge(k)) continue;
      if (typeof a === 'number' && typeof b === 'number') {
        edges.push(k);
        continue;
      }
      const key = a + '\n' + b;
      const bundle = bundles.get(key);
      if (bundle === undefined) bundles.set(key, { from: a, to: b, edges: [k] });
      else bundle.edges.push(k);
    }
  }

  const more = new Map();
  const others = new Map();
  const chips = new Map();
  const asking = new Set(also);
  for (const u of drawn) {
    if (typeof u !== 'number') continue;
    const chip = fold === null ? null : fold.chip(u);
    if (chip !== null) chips.set(u, chip);
    const look = lookOf(u);
    if (look === null) continue;
    const hidden = neighbours(model, filter, u, look.flow).filter((f) => !represented(f.node)).length;
    if (hidden > 0) more.set(u, hidden);
    if (look.also === null) continue;
    const count = neighbours(model, filter, u, look.also).filter((f) => !inFlow(f.node)).length;
    if (count > 0) others.set(u, { look: look.also, count, shown: asking.has(u) });
  }

  return {
    focus,
    hops,
    cap,
    nodes: drawn,
    layer,
    side: sideOf,
    parent,
    edges,
    bundles: [...bundles.values()],
    groups: new Map(shown.map((group) => [group.id, group])),
    chips,
    more,
    others,
    context,
    left: left.size,
    behind: behindOf.size,
    reached: tree.layer.size,
  };
};

/**
 * The way from the focus to a drawn unit, focus first: the units each was
 * reached from, read back. Empty for anything not drawn.
 */
export const trace = (hood, target) => {
  if (!hood.layer.has(target)) return [];
  const path = [target];
  for (let at = hood.parent.get(target); at !== undefined; at = hood.parent.get(at)) path.push(at);
  return path.reverse();
};

/** How near the camera is: shapes only, names only, or everything. */
export const zoomLevel = (scale) => (scale < 0.45 ? 'far' : scale < 0.75 ? 'mid' : 'near');

/**
 * Columns by hop, callers left of the focus and callees right of it, and one
 * band per service across them all.
 *
 * Every service is a lane as tall as its busiest column, the focus's service
 * first and the others in the order the walk met them, so an edge between two
 * services visibly crosses from one band into another. Within a lane and a
 * column the order is a single barycentre sweep outward from the focus: each
 * unit sits near the average height of what it is joined to in the columns
 * already placed, which keeps most edges short and uncrossed without a library.
 * Ties fall to the label, so the same graph always draws the same way.
 */
export const layout = (model, hood, size = {}) => {
  const column = size.column || 240;
  const row = size.row || 52;
  const laneGap = size.laneGap || 0;
  const laneHead = size.laneHead || 0;
  const groups = hood.groups || new Map();
  const isNode = (v) => typeof v === 'number';
  const laneOf = (v) => (isNode(v) ? model.nodes[v][FIELD.repo] : groups.get(v).repo);
  const nameOf = (v) => (isNode(v) ? model.nodes[v][FIELD.label] : groups.get(v).owner || groups.get(v).id);
  // The busiest group first and the one holding the rest last; nodes by label.
  const weight = (v) => (isNode(v) ? 0 : groups.get(v).level === 'rest' ? -1 : groups.get(v).members.length);
  const named = (a, b) => {
    if (weight(a) !== weight(b)) return weight(b) - weight(a);
    const la = nameOf(a);
    const lb = nameOf(b);
    if (la !== lb) return la < lb ? -1 : 1;
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
  };

  const links = new Map(hood.nodes.map((v) => [v, new Set()]));
  const join = (a, b) => {
    links.get(a).add(b);
    links.get(b).add(a);
  };
  for (const k of hood.edges) join(model.edges[k][EDGE.from], model.edges[k][EDGE.to]);
  for (const bundle of hood.bundles || []) join(bundle.from, bundle.to);

  const laneOrder = [];
  for (const v of hood.nodes) if (!laneOrder.includes(laneOf(v))) laneOrder.push(laneOf(v));
  const cells = new Map();
  for (const v of hood.nodes) pushTo(cells, laneOf(v) + '/' + hood.layer.get(v), v);
  const layers = [...new Set(hood.nodes.map((v) => hood.layer.get(v)))].sort((a, b) => a - b);
  const min = layers[0];
  const max = layers[layers.length - 1];

  let top = 0;
  const lanes = laneOrder.map((repo) => {
    let rows = 0;
    for (const at of layers) rows = Math.max(rows, (cells.get(repo + '/' + at) || []).length);
    const lane = { repo, y: top, rows, height: laneHead + rows * row };
    top += lane.height + laneGap;
    return lane;
  });

  const yOf = new Map();
  const place = (at) => {
    for (const lane of lanes) {
      const list = cells.get(lane.repo + '/' + at);
      if (list === undefined) continue;
      const centre = new Map();
      for (const v of list) {
        let sum = 0;
        let count = 0;
        for (const w of links.get(v)) {
          if (!yOf.has(w)) continue;
          sum += yOf.get(w);
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
      const offset = (lane.rows - list.length) / 2;
      list.forEach((v, r) => yOf.set(v, lane.y + laneHead + (offset + r) * row));
    }
  };
  place(0);
  for (let at = 1; at <= max; at += 1) place(at);
  for (let at = -1; at >= min; at -= 1) place(at);

  const columns = new Map();
  for (const at of layers) {
    const list = lanes.flatMap((lane) => cells.get(lane.repo + '/' + at) || []);
    columns.set(at, list);
  }
  const pos = new Map();
  for (const [at, list] of columns) {
    list.forEach((v, r) => pos.set(v, { x: (at - min) * column, y: yOf.get(v), layer: at, row: r }));
  }
  return {
    pos,
    columns,
    links,
    lanes,
    min,
    max,
    width: (max - min + 1) * column,
    height: Math.max(0, top - laneGap),
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
  const atLine = node[FIELD.file] >= 0 && node[FIELD.line] > 0
    ? (model.rowsInFile.get(fileKey(node[FIELD.repo], node[FIELD.file])) || [])
      .filter((r) => model.data.rows[r][ROW.node] < 0 && model.data.rows[r][ROW.line] === node[FIELD.line])
    : [];
  const mine = new Set([...rows, ...atLine]);
  const inFile = node[FIELD.file] >= 0
    ? (model.rowsInFile.get(fileKey(node[FIELD.repo], node[FIELD.file])) || []).filter((r) => !mine.has(r))
    : [];
  return {
    into: group(model.incoming[i], EDGE.from),
    out: group(model.outgoing[i], EDGE.to),
    rows,
    atLine,
    inFile,
  };
};

/*
 * Checking: the questions a person checks the graph with, each answered as a
 * set of nodes the drawing can draw.
 *
 *   createProblems  which nodes carry rows, as badges and as one list
 *   onlyProblems    a drawing cut down to the nodes with problems
 *   shortestPath    does A reach B, and by which shortest ways
 *   upstream        everything that reaches a node, as `flowatlas impact` walks it
 *   impactView      that walk, cut to a drawing
 *   editorUrl       a `file:line` as a link an editor opens
 *
 * A path and an impact come back in the shape `neighbourhood` returns - focus,
 * nodes, layer, edges, more, left - so the one layout and the one renderer draw
 * every answer, and the page only chooses which question is asked.
 */

/**
 * Edges a walk back towards the ways in follows: `REVERSE_EDGES`, the list the
 * `impact` command walks. A test holds the two equal.
 */
export const UPSTREAM = Object.freeze([
  'handles', 'calls', 'queries', 'caches', 'emits', 'consumes', 'http_calls', 'hits', 'triggers', 'reads_config',
]);

/** Edges that leave one service for another. */
export const CROSSING = Object.freeze(['http_calls', 'hits']);

/** How far a walk back goes before the steps it climbs lengthen it: `DEFAULT_FLOW_DEPTH`. */
export const IMPACT_DEPTH = 8;

/** Node types a person comes in through: the list of ways in on the left. */
const DOOR_TYPES = new Set(['entry', 'ui_action']);

/** Calls that should land somewhere: a call to another service, a browser call. */
const CALL_TYPES = new Set(['http_out', 'ui_api_call']);

const typeIndices = (model, names) => {
  const wanted = new Set(names);
  return new Set(model.data.dicts.edgeTypes.flatMap((name, k) => (wanted.has(name) ? [k] : [])));
};

const typeOfNode = (model, i) => model.data.dicts.types[model.nodes[i][FIELD.type]];

const lineKey = (repo, file, line) => repo + ':' + file + ':' + line;

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/**
 * Which nodes carry problems, and how many.
 *
 * A problem is a row. A row that names a node is that node's; a row that names
 * none but sits in a node's file at the node's line is counted on the node too,
 * and said apart, since the row is at the node without claiming to be about it.
 * A row at a line two nodes share counts on both. Rows elsewhere in the file
 * are not counted: the details panel lists them, labelled as such.
 *
 * `badgesFor(node)` is the hook the renderer draws: one badge per kind, only
 * the kinds there are, each `{ kind, count, title }`.
 */
export const createProblems = (model) => {
  const rows = model.data.rows || [];
  const { reasons, files } = model.data.dicts;
  const at = new Map();
  rows.forEach((row, r) => {
    if (row[ROW.node] < 0 && row[ROW.file] >= 0 && row[ROW.line] > 0) {
      pushTo(at, lineKey(row[ROW.repo], row[ROW.file], row[ROW.line]), r);
    }
  });
  const none = [];
  const atLineOf = (i) => {
    const node = model.nodes[i];
    if (!(node[FIELD.file] >= 0 && node[FIELD.line] > 0)) return none;
    return at.get(lineKey(node[FIELD.repo], node[FIELD.file], node[FIELD.line])) || none;
  };
  const counts = model.nodes.map((_, i) => (model.rowsOn.get(i) || none).length + atLineOf(i).length);

  const reasonsOf = (list) => [...new Set(list.map((r) => reasons[rows[r][ROW.reason]]))].sort();
  const of = (i) => ({ on: model.rowsOn.get(i) || none, atLine: atLineOf(i) });
  const count = (i) => counts[i];
  const has = (i) => counts[i] > 0;

  const badgesFor = (i) => {
    const { on, atLine } = of(i);
    const badges = [];
    if (on.length > 0) {
      badges.push({
        kind: 'rows',
        count: on.length,
        title: `${plural(on.length, 'row names', 'rows name')} this node: ${reasonsOf(on).join(', ')}`,
      });
    }
    if (atLine.length > 0) {
      const node = model.nodes[i];
      badges.push({
        kind: 'line',
        count: atLine.length,
        title: `${plural(atLine.length, 'row', 'rows')} at ${files[node[FIELD.file]]}:${node[FIELD.line]}, ` +
          `naming no node: ${reasonsOf(atLine).join(', ')}`,
      });
    }
    return badges;
  };

  let listed = null;
  /**
   * The one list of problems: ways in that carry rows or whose handler was not
   * read, crossings with rows at either end, and calls that joined nothing or
   * carry rows. Each list in service, then label, order.
   */
  const list = () => {
    if (listed !== null) return listed;
    const { edgeTypes } = model.data.dicts;
    const order = (a, b) => model.nodes[a][FIELD.repo] - model.nodes[b][FIELD.repo] || byLabel(model)(a, b);
    const handles = edgeTypes.indexOf('handles');
    const crossing = typeIndices(model, CROSSING);
    const waysIn = [];
    const calls = [];
    model.nodes.forEach((node, i) => {
      const type = typeOfNode(model, i);
      if (DOOR_TYPES.has(type)) {
        const handled = type !== 'entry' || model.outgoing[i].some((k) => model.edges[k][EDGE.type] === handles);
        if (has(i) || !handled) waysIn.push({ node: i, rows: counts[i], unhandled: !handled });
      } else if (CALL_TYPES.has(type)) {
        const joined = model.outgoing[i].length > 0;
        if (has(i) || !joined) calls.push({ node: i, rows: counts[i], unjoined: !joined });
      }
    });
    waysIn.sort((a, b) => order(a.node, b.node));
    calls.sort((a, b) => order(a.node, b.node));
    const crossings = [];
    model.edges.forEach((edge, k) => {
      if (!crossing.has(edge[EDGE.type])) return;
      const total = counts[edge[EDGE.from]] + counts[edge[EDGE.to]];
      if (total > 0) crossings.push({ edge: k, rows: total });
    });
    crossings.sort((a, b) => order(model.edges[a.edge][EDGE.from], model.edges[b.edge][EDGE.from]) ||
      order(model.edges[a.edge][EDGE.to], model.edges[b.edge][EDGE.to]));
    listed = { waysIn, crossings, calls };
    return listed;
  };

  return { of, count, has, badgesFor, reasonsOf, list, total: rows.length };
};

/**
 * A drawing cut down to the nodes with problems, and what joins them to the
 * focus.
 *
 * A node stays when it has problems, or when it is the step between the focus
 * and one that does, so what is left is still a drawing of how each problem is
 * reached rather than islands. A group stays when one of its members has
 * problems, and is joined by its bundles as a node is by its edges; a chip
 * stays with its node. Says how many it took away; a filter hides, it never
 * counts as the cap.
 */
export const onlyProblems = (model, hood, keep) => {
  const groups = hood.groups || new Map();
  const bundles = hood.bundles || [];
  const has = (u) => (typeof u === 'number' ? keep(u) : groups.get(u).members.some(keep));
  const near = new Map(hood.nodes.map((v) => [v, []]));
  const join = (a, b) => {
    near.get(a).push(b);
    near.get(b).push(a);
  };
  for (const k of hood.edges) join(model.edges[k][EDGE.from], model.edges[k][EDGE.to]);
  for (const bundle of bundles) join(bundle.from, bundle.to);
  const far = (v) => Math.abs(hood.layer.get(v));
  const kept = new Set([hood.focus]);
  const outward = [...hood.nodes].sort((a, b) => far(b) - far(a));
  for (const v of outward) {
    if (has(v) || near.get(v).some((w) => kept.has(w) && far(w) > far(v))) kept.add(v);
  }
  const nodes = hood.nodes.filter((v) => kept.has(v));
  const only = (map) => new Map([...map].filter(([v]) => kept.has(v)));
  return {
    ...hood,
    nodes,
    layer: new Map(nodes.map((v) => [v, hood.layer.get(v)])),
    edges: hood.edges.filter((k) => kept.has(model.edges[k][EDGE.from]) && kept.has(model.edges[k][EDGE.to])),
    bundles: bundles.filter((bundle) => kept.has(bundle.from) && kept.has(bundle.to)),
    groups: only(groups),
    chips: only(hood.chips || new Map()),
    parent: only(hood.parent || new Map()),
    more: only(hood.more),
    clean: hood.nodes.length - nodes.length,
  };
};

/**
 * A question's drawing - a path, an impact walk - given what a neighbourhood
 * carries, so the renderer, the trace and the layout read it the same way:
 * `parent`, the unit each was reached from; no groups or bundles, since a
 * question's answer is every node on it; and plumbing folded into chips on the
 * nodes it wraps, drawn beside a node in `fold.unfolded` as a neighbourhood
 * draws it. Without `fold`, no chips.
 */
const asDrawing = (model, hood, parent, fold) => {
  const drawing = {
    ...hood,
    parent,
    side: new Map(),
    bundles: [],
    groups: new Map(),
    chips: new Map(),
    others: new Map(),
    context: new Map(),
    behind: 0,
  };
  if (!fold) return drawing;
  const folding = foldPlumbing(model, { ...fold, focus: hood.focus });
  const nodes = [...hood.nodes];
  const layer = new Map(hood.layer);
  const edges = new Set(hood.edges);
  const parents = new Map(parent);
  for (const u of hood.nodes) {
    const chip = folding.chip(u);
    if (chip !== null) drawing.chips.set(u, chip);
    if (!folding.unfolded.has(u)) continue;
    for (const k of folding.chain(u)) {
      const v = model.edges[k][EDGE.to];
      if (!layer.has(v)) {
        layer.set(v, layer.get(u) + 1);
        parents.set(v, u);
        nodes.push(v);
      }
      edges.add(k);
    }
  }
  return { ...drawing, nodes, layer, edges: [...edges], parent: parents };
};

/** Paths a search may be asked to look along. */
export const PATH_DEPTHS = Object.freeze([6, 12, 24]);

/**
 * The shortest way or ways from one node to another, as a drawing.
 *
 * Directed by default: along the edges the way the calls run. Undirected, an
 * edge is walked either way, which answers "are these joined at all". The
 * filters apply, except to the two ends, which were asked for by name. Every
 * node on some shortest path is drawn, one column per step, up to the cap;
 * past it one whole path is drawn first, so a cut never leaves a gap. Says
 * how many shortest paths there are and how many nodes it left out.
 *
 * With no path within `depth` steps, says so and how many nodes it searched,
 * so "no path" reads as "none within what was searched".
 */
export const shortestPath = (model, options) => {
  const from = options.from;
  const to = options.to;
  const directed = options.directed !== false;
  const depth = options.depth === undefined ? 12 : options.depth;
  const cap = options.cap === undefined ? 60 : options.cap;
  const filter = options.filter || ALL;

  const through = (v) => v === from || v === to || filter.node(v);
  const moves = (u, forward) => {
    const found = [];
    const look = (list, end) => {
      for (const k of list) {
        const v = model.edges[k][end];
        if (v !== u && filter.edge(k) && through(v)) found.push([v, k]);
      }
    };
    if (!directed || forward) look(model.outgoing[u], EDGE.to);
    if (!directed || !forward) look(model.incoming[u], EDGE.from);
    return found;
  };
  const spread = (start, forward, limit, stopAt) => {
    const dist = new Map([[start, 0]]);
    let frontier = [start];
    for (let d = 1; d <= limit && frontier.length > 0 && !dist.has(stopAt); d += 1) {
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

  const base = { focus: from, from, to, directed, depth, cap, more: new Map(), expandable: false };
  const ahead = spread(from, true, depth, to);
  if (!ahead.has(to)) {
    return asDrawing(model, {
      ...base,
      found: false,
      hops: depth,
      searched: ahead.size,
      nodes: [from, to],
      layer: new Map([[from, 0], [to, 1]]),
      edges: [],
      left: 0,
      reached: ahead.size,
      paths: 0,
      length: null,
    }, new Map(), options.fold);
  }

  const length = ahead.get(to);
  const behind = spread(to, false, length, -1);
  const on = (v) => ahead.has(v) && behind.has(v) && ahead.get(v) + behind.get(v) === length;
  const named = byLabel(model);
  const onPath = [...ahead.keys()].filter(on).sort((a, b) => ahead.get(a) - ahead.get(b) || named(a, b));

  // Edges along a shortest path, and the next nodes each node leads to.
  const edges = new Set();
  const next = new Map(onPath.map((v) => [v, new Set()]));
  for (const u of onPath) {
    for (const [v, k] of moves(u, true)) {
      if (on(v) && ahead.get(v) === ahead.get(u) + 1) {
        edges.add(k);
        next.get(u).add(v);
      }
    }
  }
  const ways = new Map([[from, 1]]);
  for (const u of onPath) for (const v of next.get(u)) ways.set(v, (ways.get(v) || 0) + (ways.get(u) || 0));

  const drawn = [];
  if (onPath.length > cap) {
    // One whole path first, the first by label at every step.
    for (let u = from; u !== undefined; u = [...next.get(u)].sort(named)[0]) drawn.push(u);
  }
  const placed = new Set(drawn);
  for (const v of onPath) {
    if (drawn.length >= cap) break;
    if (!placed.has(v)) {
      placed.add(v);
      drawn.push(v);
    }
  }
  // Each drawn node was reached from the first drawn node, by label, a step
  // before it, so a hover lights one whole way back to the start.
  const parent = new Map();
  for (const u of drawn) {
    for (const v of next.get(u)) {
      if (placed.has(v) && (!parent.has(v) || named(u, parent.get(v)) < 0)) parent.set(v, u);
    }
  }
  return asDrawing(model, {
    ...base,
    found: true,
    hops: length,
    length,
    paths: from === to ? 1 : ways.get(to) || 0,
    searched: ahead.size,
    nodes: drawn,
    layer: new Map(drawn.map((v) => [v, ahead.get(v)])),
    edges: [...edges].filter((k) => placed.has(model.edges[k][EDGE.from]) && placed.has(model.edges[k][EDGE.to])),
    left: onPath.length - drawn.length,
    reached: onPath.length,
  }, parent, options.fold);
};

/**
 * Everything that reaches a node, walked the way `flowatlas impact` walks it.
 *
 * Back along `UPSTREAM` edges, `IMPACT_DEPTH` hops, lengthened by one hop for
 * every step of a chain the walk climbs (`walkBack`): `data.steps` names the
 * nodes that are steps. A depth given is kept as given, as `--depth` is. No
 * filter applies: this is the command's answer, drawn.
 *
 * `entries` are the entry points the command lists; `doors` are every way in
 * the page lists, which adds the screen actions a browser starts from.
 * `withoutEntry` are the services the walk reached and found no entry point
 * in, which the command reports too.
 */
export const upstream = (model, target, options = {}) => {
  const walkable = typeIndices(model, UPSTREAM);
  const steps = new Set(model.data.steps || []);
  const base = options.depth === undefined ? IMPACT_DEPTH : options.depth;
  const walk = (limit) => {
    const dist = new Map([[target, 0]]);
    let frontier = [target];
    for (let d = 1; d <= limit && frontier.length > 0; d += 1) {
      const next = [];
      for (const u of frontier) {
        for (const k of model.incoming[u]) {
          const v = model.edges[k][EDGE.from];
          if (dist.has(v) || !walkable.has(model.edges[k][EDGE.type])) continue;
          dist.set(v, d);
          next.push(v);
        }
      }
      frontier = next;
    }
    return dist;
  };
  let depth = base;
  let dist = walk(depth);
  while (options.depth === undefined) {
    let climbed = 0;
    for (const v of dist.keys()) if (steps.has(v)) climbed += 1;
    if (base + climbed <= depth) break;
    depth = base + climbed;
    dist = walk(depth);
  }

  const named = byLabel(model);
  const doors = [...dist.keys()]
    .filter((v) => v !== target && DOOR_TYPES.has(typeOfNode(model, v)))
    .sort((a, b) => dist.get(a) - dist.get(b) || named(a, b));
  const entries = doors.filter((v) => typeOfNode(model, v) === 'entry');
  const services = new Set([...dist.keys()].map((v) => model.nodes[v][FIELD.repo]));
  const entered = new Set(entries.map((v) => model.nodes[v][FIELD.repo]));
  return {
    target,
    depth,
    dist,
    reached: dist.size - 1,
    doors,
    entries,
    services: [...services].sort((a, b) => a - b),
    withoutEntry: [...services].filter((s) => !entered.has(s)).sort((a, b) => a - b),
  };
};

/**
 * An impact walk as a drawing: the node changed at the right, everything that
 * reaches it to the left, one column per hop back.
 *
 * Under the cap, every way in is drawn first with one chain from it down to the
 * node, nearest way in first, so the answer to "what reaches this" survives
 * the cut; then the rest, nearest first. A drawn node with callers not drawn
 * carries their count, and expanding it draws them.
 */
export const impactView = (model, found, options = {}) => {
  const cap = options.cap === undefined ? 60 : options.cap;
  const expanded = options.expanded || [];
  const walkable = typeIndices(model, UPSTREAM);
  const { target, dist } = found;
  const named = byLabel(model);
  const layer = new Map([[target, 0]]);
  const drawn = [target];
  const add = (v) => {
    if (layer.has(v)) return;
    layer.set(v, -dist.get(v));
    drawn.push(v);
  };
  const callers = (u) => {
    const list = [];
    for (const k of model.incoming[u]) {
      const v = model.edges[k][EDGE.from];
      if (walkable.has(model.edges[k][EDGE.type]) && dist.has(v) && v !== u && !list.includes(v)) list.push(v);
    }
    return list.sort(named);
  };
  const toward = (u) => {
    let best = -1;
    for (const k of model.outgoing[u]) {
      const w = model.edges[k][EDGE.to];
      if (!walkable.has(model.edges[k][EDGE.type]) || dist.get(w) !== dist.get(u) - 1) continue;
      if (best < 0 || named(w, best) < 0) best = w;
    }
    return best;
  };

  for (const door of found.doors) {
    const chain = [];
    for (let u = door; u >= 0 && !layer.has(u); u = toward(u)) chain.push(u);
    if (drawn.length + chain.length <= cap) chain.forEach(add);
  }
  const rest = [...dist.keys()].filter((v) => !layer.has(v)).sort((a, b) => dist.get(a) - dist.get(b) || named(a, b));
  for (const v of rest) {
    if (drawn.length >= cap) break;
    add(v);
  }
  for (const u of expanded) if (layer.has(u)) callers(u).forEach(add);

  const edges = [];
  const more = new Map();
  // Each drawn node's way on toward the node changed, for the trace: the
  // first, by label, drawn a hop nearer it.
  const parent = new Map();
  for (const u of drawn) {
    for (const k of model.outgoing[u]) {
      const w = model.edges[k][EDGE.to];
      if (w !== u && layer.has(w) && walkable.has(model.edges[k][EDGE.type])) {
        edges.push(k);
        const nearer = dist.get(w) === dist.get(u) - 1;
        if (nearer && (!parent.has(u) || named(w, parent.get(u)) < 0)) parent.set(u, w);
      }
    }
    const hidden = callers(u).filter((v) => !layer.has(v)).length;
    if (hidden > 0) more.set(u, hidden);
  }
  return asDrawing(model, {
    focus: target,
    hops: found.depth,
    cap,
    nodes: drawn,
    layer,
    edges,
    more,
    left: dist.size - drawn.length,
    reached: dist.size,
  }, parent, options.fold);
};

/**
 * How each editor is asked to open a file at a line. `file` opens the file in
 * whatever the system opens it with, and no file URL can carry a line.
 */
const EDITORS = Object.freeze({
  vscode: (path, line) => 'vscode://file' + path + (line > 0 ? ':' + line : ''),
  cursor: (path, line) => 'cursor://file' + path + (line > 0 ? ':' + line : ''),
  idea: (path, line) => 'idea://open?file=' + encodeURIComponent(path) + (line > 0 ? '&line=' + line : ''),
  file: (path) => 'file://' + path,
});

export const EDITOR_NAMES = Object.freeze(Object.keys(EDITORS));

/**
 * A link that opens `file` at `line` in an editor, or null when there is no
 * editor, no root or no file to open.
 *
 * `root` is the repository's absolute directory and `file` is relative to it,
 * as the graph keeps it. The path keeps its slashes and a drive's colon and
 * escapes the rest, so a space or a `#` in a folder name cannot end the link.
 */
export const editorUrl = (editor, root, file, line) => {
  const build = Object.hasOwn(EDITORS, editor) ? EDITORS[editor] : null;
  if (build === null || !root || !file) return null;
  const joined = (root.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + file.replace(/\\/g, '/').replace(/^(\.\/)+/, ''));
  const absolute = joined.startsWith('/') ? joined : '/' + joined;
  // A drive letter is a path of its own to an IDE, and a URL path to the rest.
  const path = editor === 'idea'
    ? (/^[A-Za-z]:\//.test(joined) ? joined : absolute)
    : encodeURI(absolute).replace(/[?#]/g, encodeURIComponent);
  return build(path, line);
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
