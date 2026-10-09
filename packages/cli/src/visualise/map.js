/*
 * The Map tab's logic: the project at the size of its services.
 *
 * Pure functions, like graph.js and frame.js beside it, written into the same
 * module script by the command and imported as they are by a test:
 *   createMap     the packed map, indexed: boxes, links, clusters
 *   mapView       what is drawn for a state - which clusters are open, which
 *                 kinds of link are hidden, the packages layer, a focus - as
 *                 units (a box, or a closed cluster) and links between units
 *   mapLayout     where each unit goes: a column per role, left to right in
 *                 the order a request travels, ordered within a column so the
 *                 links cross as little as a few sweeps can make them
 *   mapCycles     the units that reach each other, and the links inside them
 *   mapMarks      a number per unit for what is being checked
 *   serviceInside a service's ways in and its busiest classes
 *   parseMapHash, formatMapHash   the view in the address, by name
 */

export const MAP_BOX_KINDS = Object.freeze(['service', 'channel', 'data', 'external', 'package']);
export const MAP_COLUMNS = Object.freeze(['front', 'api', 'channel', 'worker', 'library', 'data', 'external', 'package']);
export const MAP_LINK_KINDS = Object.freeze(['http', 'message', 'workflow', 'invoke', 'db', 'external', 'calls', 'package']);

/** What can be checked on the map, in the order the page offers them. */
export const MAP_MARKS = Object.freeze(['problems', 'dead', 'uncalled', 'cycles', 'unread']);

/**
 * Sizes of the drawing, in its own units. An open family taller than `wrap`
 * boxes is laid out in as many sub-columns as it takes, `side` apart, so a
 * family of sixty is a block rather than a column off the screen.
 */
export const MAP_BOX = Object.freeze({ w: 214, h: 46, gap: 10, column: 150, head: 24, pad: 8, wrap: 14, side: 16 });

/**
 * Clusters start open while the map is small enough to read with every box
 * drawn, and closed past it; the packages layer has its own threshold.
 */
export const MAP_OPEN_UNDER = Object.freeze({ boxes: 40, packages: 30 });

const PACKAGE = MAP_LINK_KINDS.indexOf('package');

/** A box's id: what it is and its name, the same in every build that has it. */
export const boxId = (box) => MAP_BOX_KINDS[box.k] + ':' + box.n;

/** A cluster's id: its column and the family it gathers. */
export const clusterId = (box) => 'cluster:' + MAP_COLUMNS[box.c] + ':' + box.g;

/**
 * The packed map, indexed. A cluster is the boxes of one column that share a
 * family, which the page names the way its members are named.
 */
export const createMap = (packed) => {
  const boxes = packed.boxes;
  const clusters = new Map();
  boxes.forEach((box, i) => {
    if (box.g === '') return;
    const id = clusterId(box);
    const found = clusters.get(id) || { id, column: box.c, key: box.g, kind: box.k, members: [] };
    found.members.push(i);
    clusters.set(id, found);
  });
  const byId = new Map(boxes.map((box, i) => [boxId(box), i]));
  const runtime = boxes.filter((box) => MAP_BOX_KINDS[box.k] !== 'package').length;
  const packages = boxes.length - runtime;
  return { packed, boxes, links: packed.links, clusters, byId, sizes: { runtime, packages } };
};

/** Whether a cluster is open when nobody has said otherwise. */
export const openByDefault = (map, id) => {
  const cluster = map.clusters.get(id);
  if (!cluster) return false;
  return MAP_BOX_KINDS[cluster.kind] === 'package'
    ? map.sizes.packages <= MAP_OPEN_UNDER.packages
    : map.sizes.runtime <= MAP_OPEN_UNDER.boxes;
};

/** A cluster's state: its default, unless the person toggled it. */
export const isOpen = (map, id, toggled) => openByDefault(map, id) !== toggled.has(id);

const BEST = ['static', 'marker', 'declared', 'runtime', 'heuristic'];

/**
 * What is drawn: units and the links between them.
 *
 * A box in a closed cluster is drawn as its cluster; a link between two
 * boxes is drawn between their units, merged with every other link of the
 * same kind between the same two units, and dropped when both ends are the
 * same unit - it is inside a closed cluster, and the cluster says how many.
 * Packages are drawn only with the packages layer, development dependencies
 * only when asked for too. With a focus, only the focus and the units one
 * link from it are drawn.
 *
 * `state`: `{ toggled: Set, hidden: Set of kinds, packages, dev, focus }`.
 */
export const mapView = (map, state, confidences = []) => {
  const toggled = state.toggled || new Set();
  const hidden = state.hidden || new Set();
  const unitOf = map.boxes.map((box) => (box.g !== '' && !isOpen(map, clusterId(box), toggled) ? clusterId(box) : boxId(box)));
  const shown = (i) => MAP_BOX_KINDS[map.boxes[i].k] !== 'package' || state.packages;

  const merged = new Map();
  const inside = new Map();
  map.links.forEach((link, i) => {
    if (hidden.has(MAP_LINK_KINDS[link.k])) return;
    if (link.k === PACKAGE && (!state.packages || (link.d && !state.dev))) return;
    if (!shown(link.f) || !shown(link.t)) return;
    const from = unitOf[link.f];
    const to = unitOf[link.t];
    if (from === to) {
      inside.set(from, (inside.get(from) || 0) + link.n);
      return;
    }
    const id = from + '>' + to + '>' + MAP_LINK_KINDS[link.k];
    const found = merged.get(id) ||
      { id, from, to, kind: MAP_LINK_KINDS[link.k], count: 0, links: [], best: -1, worst: -1, dev: true };
    found.count += link.n;
    found.links.push(i);
    if (!link.d) found.dev = false;
    for (const c of [link.b, link.w]) {
      if (c === undefined || c < 0) continue;
      const rank = BEST.indexOf(confidences[c]);
      if (found.best < 0 || rank < BEST.indexOf(confidences[found.best])) found.best = c;
      if (found.worst < 0 || rank > BEST.indexOf(confidences[found.worst])) found.worst = c;
    }
    merged.set(id, found);
  });

  const units = new Map();
  map.boxes.forEach((box, i) => {
    if (!shown(i)) return;
    const id = unitOf[i];
    const found = units.get(id);
    if (found) {
      found.members.push(i);
      return;
    }
    const closed = id !== boxId(box);
    units.set(id, {
      id,
      column: box.c,
      cluster: box.g === '' ? null : clusterId(box),
      closed,
      box: closed ? -1 : i,
      members: [i],
      inside: 0,
    });
  });
  for (const [id, n] of inside) if (units.has(id)) units.get(id).inside = n;

  let links = [...merged.values()].filter((link) => units.has(link.from) && units.has(link.to));
  // A package nobody draws a link to - its users are development-only and
  // development is not asked for - is not drawn either.
  for (const [id, unit] of units) {
    if (unit.members.every((i) => MAP_BOX_KINDS[map.boxes[i].k] !== 'package')) continue;
    if (!links.some((link) => link.from === id || link.to === id)) units.delete(id);
  }

  const focus = state.focus && units.has(state.focus) ? state.focus : null;
  if (focus !== null) {
    links = links.filter((link) => link.from === focus || link.to === focus);
    const keep = new Set([focus, ...links.flatMap((link) => [link.from, link.to])]);
    for (const id of [...units.keys()]) if (!keep.has(id)) units.delete(id);
  }
  return { units, links, focus };
};

/** The neighbours of each unit, either way. */
const unitNeighbours = (view) => {
  const out = new Map([...view.units.keys()].map((id) => [id, []]));
  for (const link of view.links) {
    out.get(link.from).push(link.to);
    out.get(link.to).push(link.from);
  }
  return out;
};

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Where everything goes.
 *
 * One column per role that has anything in it, left to right. Within a
 * column, blocks - a unit on its own, or an open cluster's units together
 * under a frame - start in name order and are then sorted by where their
 * neighbours sit, a few sweeps each way, which is what keeps most links short
 * and few of them crossing. The same view always gives the same picture.
 *
 * A block sorts by its name, or a cluster by its family, where its
 * neighbours sit does not decide.
 */
export const mapLayout = (map, view, sweeps = 4) => {
  const { w, h, gap, column: colGap, head, pad, wrap, side } = MAP_BOX;
  const near = unitNeighbours(view);
  const columns = MAP_COLUMNS.map(() => []);
  const blockOf = new Map();
  for (const unit of view.units.values()) {
    const blocks = columns[unit.column];
    const key = unit.cluster !== null && !unit.closed ? unit.cluster : unit.id;
    let block = blockOf.get(key);
    if (!block) {
      block = {
        key,
        label: unit.cluster !== null ? map.clusters.get(unit.cluster).key : map.boxes[unit.members[0]].n,
        frame: unit.cluster !== null && !unit.closed ? unit.cluster : null,
        units: [],
      };
      blockOf.set(key, block);
      blocks.push(block);
    }
    block.units.push(unit.id);
  }
  for (const blocks of columns) {
    blocks.sort((a, b) => byName(a.label, b.label) || byName(a.key, b.key));
    for (const block of blocks) {
      block.units.sort(byName);
      block.across = block.frame && block.units.length > wrap ? Math.ceil(block.units.length / wrap) : 1;
      block.down = Math.ceil(block.units.length / block.across);
    }
  }

  const used = columns.map((blocks, i) => (blocks.length > 0 ? i : -1)).filter((i) => i >= 0);
  const widthOf = (c) => Math.max(...columns[c].map((block) => block.across)) * (w + side) - side;
  const xOf = new Map();
  let x = 0;
  for (const c of used) {
    xOf.set(c, x);
    x += widthOf(c) + colGap;
  }
  // Within a wrapped family a box fills down first, then across, so the
  // family still reads in its order.
  // `along` is where a box would sit were its family not wrapped: what a box
  // with no neighbours elsewhere is ordered by, so it keeps its place.
  const centre = new Map();
  const across = new Map();
  const along = new Map();
  const stack = (c) => {
    let y = 0;
    for (const block of columns[c]) {
      if (block.frame) y += head;
      block.units.forEach((id, i) => {
        const row = i % block.down;
        centre.set(id, y + row * (h + gap) + h / 2);
        along.set(id, y + i * (h + gap) + h / 2);
        across.set(id, Math.floor(i / block.down) * (w + side));
      });
      y += block.down * (h + gap);
      if (block.frame) y += pad;
    }
    return y;
  };
  for (const c of used) stack(c);

  const score = (id, fallback) => {
    const others = near.get(id).filter((other) => view.units.get(other).column !== view.units.get(id).column);
    if (others.length === 0) return fallback;
    return others.reduce((sum, other) => sum + centre.get(other), 0) / others.length;
  };
  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    const order = sweep % 2 === 0 ? used : [...used].reverse();
    for (const c of order) {
      const scored = new Map();
      const blockAt = new Map();
      for (const block of columns[c]) {
        for (const id of block.units) scored.set(id, score(id, along.get(id)));
        block.units.sort((a, b) => scored.get(a) - scored.get(b) || byName(a, b));
        blockAt.set(block, block.units.reduce((sum, id) => sum + scored.get(id), 0) / block.units.length);
      }
      columns[c].sort((a, b) => blockAt.get(a) - blockAt.get(b) || byName(a.label, b.label));
      stack(c);
    }
  }

  const heights = new Map(used.map((c) => [c, stack(c) - gap]));
  const tallest = Math.max(0, ...heights.values());
  const placed = new Map();
  const frames = [];
  for (const c of used) {
    const top = (tallest - heights.get(c)) / 2;
    for (const block of columns[c]) {
      for (const id of block.units) {
        placed.set(id, { x: xOf.get(c) + across.get(id), y: top + centre.get(id) - h / 2, w, h });
      }
      if (block.frame) {
        const ys = block.units.map((id) => placed.get(id).y);
        const first = Math.min(...ys);
        const last = Math.max(...ys);
        frames.push({
          cluster: block.frame,
          x: xOf.get(c) - 8,
          y: first - head,
          w: block.across * (w + side) - side + 16,
          h: last + h - first + head + pad - 2,
        });
      }
    }
  }
  return {
    placed,
    frames,
    columns: used.map((c) => ({ name: MAP_COLUMNS[c], x: xOf.get(c) })),
    width: used.length === 0 ? 0 : x - colGap,
    height: tallest,
  };
};

/**
 * Units that reach each other at run time - a call one way and a message
 * back, two services each calling the other - with the links that do it.
 * Strongly connected components, iteratively; manifest links are not run
 * time and are left out.
 */
export const mapCycles = (view) => {
  const ids = [...view.units.keys()];
  const out = new Map(ids.map((id) => [id, []]));
  for (const link of view.links) if (link.kind !== 'package') out.get(link.from).push(link.to);
  const order = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const group = new Map();
  let next = 0;
  for (const start of ids) {
    if (order.has(start)) continue;
    const work = [[start, 0]];
    order.set(start, next);
    low.set(start, next);
    next += 1;
    stack.push(start);
    onStack.add(start);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const [v, at] = frame;
      const targets = out.get(v);
      if (at < targets.length) {
        frame[1] += 1;
        const t = targets[at];
        if (!order.has(t)) {
          order.set(t, next);
          low.set(t, next);
          next += 1;
          stack.push(t);
          onStack.add(t);
          work.push([t, 0]);
        } else if (onStack.has(t)) {
          low.set(v, Math.min(low.get(v), order.get(t)));
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent), low.get(v)));
      }
      if (low.get(v) === order.get(v)) {
        const members = [];
        let w;
        do {
          w = stack.pop();
          onStack.delete(w);
          members.push(w);
        } while (w !== v);
        for (const m of members) group.set(m, members.length > 1 ? v : null);
      }
    }
  }
  const units = new Set(ids.filter((id) => group.get(id) !== null));
  const links = new Set(view.links
    .filter((link) => link.kind !== 'package' && group.get(link.from) !== null && group.get(link.from) === group.get(link.to))
    .map((link) => link.id));
  return { units, links };
};

/**
 * A number per unit for what is being checked, summed over a closed
 * cluster's members: rows that need an action, channels with no producer or
 * no consumer, routes nothing calls, the services nothing could read, or
 * 1 for a unit in a cycle.
 */
/**
 * How each check marks one unit: a count summed over the boxes it holds, or,
 * for cycles, whether the unit is in one at all.
 */
const sumOf = (count) => (map, unit) =>
  unit.members.reduce((n, i) => n + count(map.boxes[i]), 0);
const MARKS = {
  problems: sumOf((box) => box.s.problems || 0),
  uncalled: sumOf((box) => box.s.uncalled || 0),
  unread: sumOf((box) => box.s.unread || 0),
  dead: sumOf((box) => (MAP_BOX_KINDS[box.k] === 'channel' && (box.s.producers === 0 || box.s.consumers === 0) ? 1 : 0)),
  cycles: (map, unit, cycles) => (cycles && cycles.units.has(unit.id) ? 1 : 0),
};

export const mapMarks = (map, view, mark, cycles = null) => {
  const out = new Map();
  if (!Object.hasOwn(MARKS, mark)) return out;
  const markOf = MARKS[mark];
  for (const unit of view.units.values()) {
    const n = markOf(map, unit, cycles);
    if (n > 0) out.set(unit.id, n);
  }
  return out;
};

/**
 * Inside a service: its ways in, by kind and then name, and its busiest
 * classes - a class being the part of a method's label before its dot -
 * counted by the edges that touch their methods. Bounded both ways.
 */
export const serviceInside = (data, repo, limits = { ways: 60, classes: 12 }) => {
  const { types, repos, kinds } = data.dicts;
  const at = repos.indexOf(repo);
  if (at < 0) return { ways: [], waysLeft: 0, classes: [] };
  const ways = [];
  const classOf = new Map();
  data.nodes.forEach((node, i) => {
    if (node[2] !== at) return;
    const type = types[node[0]];
    if (type === 'entry') ways.push(i);
    if (type === 'method' || type === 'function') {
      const label = String(node[1]);
      const dot = label.indexOf('.');
      if (dot > 0) classOf.set(i, label.slice(0, dot));
    }
  });
  const weight = new Map();
  for (const edge of data.edges) {
    for (const end of [edge[0], edge[1]]) {
      const name = classOf.get(end);
      if (name !== undefined) weight.set(name, (weight.get(name) || 0) + 1);
    }
  }
  ways.sort((a, b) => byName(kinds[data.nodes[a][3]], kinds[data.nodes[b][3]]) || byName(data.nodes[a][1], data.nodes[b][1]));
  const classes = [...weight].sort((a, b) => b[1] - a[1] || byName(a[0], b[0])).slice(0, limits.classes)
    .map(([name, edges]) => ({ name, edges }));
  return { ways: ways.slice(0, limits.ways), waysLeft: Math.max(0, ways.length - limits.ways), classes };
};

const encode = (value) => encodeURIComponent(value).replace(/%3A/gi, ':');
const listOf = (text) => (text ? text.split(',').map((item) => {
  try { return decodeURIComponent(item); } catch { return null; }
}).filter((item) => item !== null && item !== '') : []);
const oneOf = (text) => {
  if (!text) return null;
  try { return decodeURIComponent(text); } catch { return null; }
};

/**
 * `#map[/s=<unit>&l=<link>&f=<unit>&t=<cluster>,…&h=<kind>,…&m=<mark>&p=1&d=1]`, or null
 * for any other address. Units and clusters are named, never numbered, so a
 * link lasts across builds; a name this page does not hold is the page's to
 * say, not this function's. An unknown mark or kind is dropped.
 */
export const parseMapHash = (hash) => {
  const found = /^#map(?:\/(.*))?$/.exec(hash || '');
  if (found === null) return null;
  const params = new Map();
  for (const part of (found[1] || '').split('&')) {
    const at = part.indexOf('=');
    if (at > 0) params.set(part.slice(0, at), part.slice(at + 1));
  }
  const mark = params.get('m');
  return {
    selected: oneOf(params.get('s')),
    link: oneOf(params.get('l')),
    focus: oneOf(params.get('f')),
    toggled: listOf(params.get('t')),
    hidden: listOf(params.get('h')).filter((kind) => MAP_LINK_KINDS.includes(kind)),
    mark: MAP_MARKS.includes(mark) ? mark : null,
    packages: params.get('p') === '1',
    dev: params.get('d') === '1',
  };
};

/** The address of a map view; a view as it opens is `#map`. */
export const formatMapHash = (state) => {
  const parts = [];
  if (state.selected) parts.push('s=' + encode(state.selected));
  if (state.link) parts.push('l=' + encode(state.link));
  if (state.focus) parts.push('f=' + encode(state.focus));
  const toggled = [...(state.toggled || [])].sort();
  if (toggled.length > 0) parts.push('t=' + toggled.map(encode).join(','));
  const hidden = [...(state.hidden || [])].sort();
  if (hidden.length > 0) parts.push('h=' + hidden.join(','));
  if (state.mark) parts.push('m=' + state.mark);
  if (state.packages) parts.push('p=1');
  if (state.packages && state.dev) parts.push('d=1');
  return parts.length === 0 ? '#map' : '#map/' + parts.join('&');
};
