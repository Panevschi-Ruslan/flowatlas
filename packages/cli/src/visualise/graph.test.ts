import { describe as group, expect, it } from 'vitest';
import {
  createFilter,
  createHistory,
  createModel,
  describe,
  foldPlumbing,
  labelParts,
  layout,
  LOOK,
  middle,
  neighbourhood,
  search,
  step,
  trace,
  zoomLevel,
} from './graph.js';

/**
 * A packed graph written by hand, in the shape `packGraph` writes, so every
 * position below can be read off the list.
 */
const types = ['entry', 'method', 'table', 'ui_api_call'];
const repos = ['api', 'web'];
const edgeTypes = ['calls', 'handles', 'hits', 'queries'];
const confidences = ['heuristic', 'static'];
const T: Record<string, number> = { entry: 0, method: 1, table: 2, ui_api_call: 3 };
const E = { calls: 0, handles: 1, hits: 2, queries: 3 } as const;
const C = { heuristic: 0, static: 1 } as const;

// [type, label, repo, kind, file, line, meta]
const node = (type: string, label: string, repo = 0, file = 0, line = 0): unknown[] => [
  T[type],
  label,
  repo,
  0,
  file,
  line,
  0,
];

const NODES = [
  /* 0 */ node('ui_api_call', 'GET /orders', 1, 1, 5),
  /* 1 */ node('entry', 'GET /orders', 0, 2, 10),
  /* 2 */ node('method', 'OrdersService.list', 0, 3, 20),
  /* 3 */ node('method', 'OrdersRepo.find', 0, 4, 7),
  /* 4 */ node('table', 'orders'),
  /* 5 */ node('method', 'Cron.sweep', 0, 3, 90),
  /* 6 */ node('method', 'Audit.find', 0, 4, 30),
];
const EDGES: number[][] = [
  [0, 1, E.hits, C.static],
  [1, 2, E.handles, C.static],
  [2, 3, E.calls, C.heuristic],
  [3, 4, E.queries, C.static],
  [5, 2, E.calls, C.static],
  [6, 3, E.calls, C.static],
];
// [node, repo, file, line, reason, level, sites, message, hint]
const ROWS: unknown[][] = [
  [3, 0, 4, 8, 0, 0, 1, 'receiver read by name only', 0],
  [-1, 0, 4, 40, 1, 1, 3, 'a dynamic table name', -1],
  [-1, 0, 3, 95, 1, 1, 1, 'elsewhere', -1],
];

const packed = (nodes: unknown[][] = NODES, edges: number[][] = EDGES) => ({
  nodes,
  edges,
  rows: ROWS,
  dicts: {
    types,
    repos,
    kinds: [''],
    files: ['', 'src/api.ts', 'src/orders.controller.ts', 'src/orders.service.ts', 'src/orders.repo.ts'],
    edgeTypes,
    confidences,
    meta: {} as Record<string, string>,
    enumerated: [] as string[],
    values: [] as string[],
    reasons: ['db-receiver-name-only', 'dynamic-table-name'],
    levels: ['action', 'info'],
    hints: ['name the class'],
  },
});

const model = createModel(packed());

group('the model', () => {
  it('keeps the edges leaving and entering each node, built once', () => {
    expect(model.outgoing[2]).toEqual([2]);
    expect(model.incoming[2]).toEqual([1, 4]);
    expect(model.outgoing[4]).toEqual([]);
  });

  it('indexes rows by the node they name and by the file they sit in', () => {
    expect(model.rowsOn.get(3)).toEqual([0]);
    expect(model.rowsInFile.get('0:4')).toEqual([0, 1]);
  });
});

group('the neighbourhood', () => {
  it('puts what reaches the focus left and what it reaches right, one column per hop', () => {
    const hood = neighbourhood(model, { focus: 2, hops: 2 });
    expect(Object.fromEntries(hood.layer)).toEqual({ 2: 0, 1: -1, 5: -1, 0: -2, 3: 1, 4: 2 });
    expect(hood.left).toBe(0);
  });

  it('looks only further out from a node on either side, so a flow reads left to right', () => {
    // Audit.find calls OrdersRepo.find, a callee of the focus: it is a caller of
    // a callee, not part of the flow, and waits to be asked for as who else
    // uses it, never counted as more of the flow.
    const hood = neighbourhood(model, { focus: 2, hops: 2 });
    expect(hood.layer.has(6)).toBe(false);
    expect(hood.more.has(3)).toBe(false);
    expect(hood.others.get(3)).toEqual({ look: 'in', count: 1, shown: false });
  });

  it('draws the edges between drawn nodes, and only those', () => {
    const hood = neighbourhood(model, { focus: 2, hops: 1 });
    expect(hood.edges.sort()).toEqual([1, 2, 4]);
  });

  it('says how many it left out when the cap applies, counting past the cap', () => {
    const hub = [node('table', 'hub'), ...Array.from({ length: 10 }, (_, i) => node('method', `caller${i}`))];
    const edges = hub.slice(1).map((_, i) => [i + 1, 0, E.queries, C.static]);
    const crowded = createModel(packed(hub, edges));
    const hood = neighbourhood(crowded, { focus: 0, hops: 1, cap: 4 });
    expect(hood.nodes).toHaveLength(4);
    expect(hood.left).toBe(7);
    expect(hood.more.get(0)).toBe(7);
    // The first three by label are the ones drawn, so the cut is the same every time.
    expect(hood.nodes.slice(1).map((v) => crowded.nodes[v as number]![1])).toEqual(['caller0', 'caller1', 'caller2']);
  });

  it('adds an expanded node’s neighbours the way it looks, on top of the cap', () => {
    const hood = neighbourhood(model, { focus: 2, hops: 1, cap: 4, expanded: [3] });
    expect(hood.layer.get(4)).toBe(2);
    expect(hood.layer.has(6)).toBe(false);
    expect(hood.more.has(3)).toBe(false);
  });

  it('hides what the filters hide, and keeps the focus whatever its service', () => {
    const noCalls = createFilter(model, { edgeTypes: new Set([E.calls]) });
    expect(neighbourhood(model, { focus: 2, hops: 2, filter: noCalls }).layer.has(3)).toBe(false);

    const noGuesses = createFilter(model, { confidences: new Set([C.heuristic]) });
    const guessless = neighbourhood(model, { focus: 2, hops: 2, filter: noGuesses });
    expect(guessless.layer.has(3)).toBe(false);
    expect(guessless.layer.has(1)).toBe(true);
    expect(noGuesses.active).toBe(true);

    const apiHidden = createFilter(model, { services: new Set([0]) });
    const hood = neighbourhood(model, { focus: 2, hops: 2, filter: apiHidden });
    expect(hood.nodes).toEqual([2]);
    expect(hood.left).toBe(0);
  });
});

group('the layout', () => {
  it('orders columns callers, focus, callees, left to right', () => {
    const hood = neighbourhood(model, { focus: 2, hops: 2 });
    const placed = layout(model, hood, { column: 100, row: 10 });
    const x = (v: number) => placed.pos.get(v)!.x;
    expect(x(0)).toBeLessThan(x(1));
    expect(x(1)).toBeLessThan(x(2));
    expect(x(2)).toBeLessThan(x(3));
    expect(x(3)).toBeLessThan(x(4));
    expect([placed.min, placed.max]).toEqual([-2, 2]);
    expect(placed.width).toBe(500);
  });

  it('keeps a node beside what it is joined to rather than in label order', () => {
    // focus calls b-first and c-second; b-first calls zed, c-second calls able.
    // By label able comes first; by what each is joined to, zed does.
    const nodes = ['focus', 'b-first', 'c-second', 'zed', 'able'].map((label) => node('method', label));
    const edges: number[][] = [
      [0, 1, E.calls, C.static],
      [0, 2, E.calls, C.static],
      [1, 3, E.calls, C.static],
      [2, 4, E.calls, C.static],
    ];
    const small = createModel(packed(nodes, edges));
    const placed = layout(small, neighbourhood(small, { focus: 0, hops: 2 }));
    expect(placed.columns.get(1)).toEqual([1, 2]);
    expect(placed.columns.get(2)).toEqual([3, 4]);
  });

  it('centres a short column against the tallest', () => {
    const hood = neighbourhood(model, { focus: 2, hops: 1 });
    const placed = layout(model, hood, { row: 10 });
    expect(placed.pos.get(2)!.y).toBe(5);
    expect(placed.height).toBe(20);
  });
});

group('the keys', () => {
  const hood = neighbourhood(model, { focus: 2, hops: 2 });
  const placed = layout(model, hood);

  it('moves up and down within a column and stops at its ends', () => {
    const [first, second] = placed.columns.get(-1)!;
    expect(step(placed, first!, 'down')).toBe(second);
    expect(step(placed, first!, 'up')).toBe(first);
  });

  it('moves left and right to a node joined to this one', () => {
    expect(step(placed, 2, 'right')).toBe(3);
    expect(step(placed, 2, 'left')).toBe(placed.columns.get(-1)![0]);
    expect(step(placed, 0, 'right')).toBe(1);
    expect(step(placed, 4, 'right')).toBe(4);
  });
});

group('search', () => {
  it('finds any node, not only a way in, by label, type, service or file', () => {
    expect(search(model, 'find').hits).toEqual([6, 3]);
    expect(search(model, 'orders.service.ts').hits).toEqual([5, 2]);
    expect(search(model, 'web').hits).toEqual([0]);
  });

  it('reads a word that is a type as the type, so the table comes first', () => {
    expect(search(model, 'table orders').hits[0]).toBe(4);
    expect(search(model, 'orders').hits[0]).toBe(4);
  });

  it('says how many it found beyond the ones it lists', () => {
    const found = search(model, 'o', 2);
    expect(found.hits).toHaveLength(2);
    expect(found.total).toBe(7);
    expect(search(model, '   ').total).toBe(0);
  });
});

group('the details', () => {
  it('groups edges in and out by type, and keeps rows on the node apart from rows in its file', () => {
    const repo = describe(model, 3);
    expect(repo.into).toEqual([{ type: E.calls, edges: [5, 2] }]);
    expect(repo.out).toEqual([{ type: E.queries, edges: [3] }]);
    expect(repo.rows).toEqual([0]);
    expect(repo.inFile).toEqual([1]);
  });
});

group('where the person has been', () => {
  it('goes back and forward, and a new visit drops what was ahead', () => {
    const trail = createHistory();
    trail.visit(1);
    trail.visit(2);
    trail.visit(2);
    trail.visit(3);
    expect(trail.back()).toBe(2);
    expect(trail.back()).toBe(1);
    expect(trail.canBack()).toBe(false);
    expect(trail.back()).toBe(1);
    expect(trail.forward()).toBe(2);
    trail.visit(9);
    expect(trail.canForward()).toBe(false);
    expect(trail.back()).toBe(2);
  });
});

/**
 * A flow through shared helpers, as on an admin route that provisions a
 * restaurant:
 *
 *   POST /restaurants ─handles→ Admin.create ─calls→ Platform.provision ─calls→ Roles.parse ─queries→ roles
 *                                    │ calls                                        ↑ calls
 *                                    ↓                         Invites.mint, and seven methods of
 *                                 Metrics.count                Shifts, Staff and Toppings
 */
const shared = (() => {
  const types = ['entry', 'method', 'table'];
  const edgeTypes = ['calls', 'handles', 'queries'];
  const nodes: unknown[][] = [];
  const edges: number[][] = [];
  const add = (type: string, label: string): number => {
    nodes.push([types.indexOf(type), label, 0, 0, 0, 1, 0]);
    return nodes.length - 1;
  };
  const join = (from: number, to: number, type: string) => edges.push([from, to, edgeTypes.indexOf(type), 0]);
  const route = add('entry', 'POST /restaurants');
  const create = add('method', 'Admin.create');
  const provision = add('method', 'Platform.provision');
  const parse = add('method', 'Roles.parse');
  const roles = add('table', 'roles');
  const metrics = add('method', 'Metrics.count');
  const mint = add('method', 'Invites.mint');
  join(route, create, 'handles');
  join(create, provision, 'calls');
  join(create, metrics, 'calls');
  join(provision, parse, 'calls');
  join(parse, roles, 'queries');
  join(mint, parse, 'calls');
  const elsewhere = ['Shifts.open', 'Shifts.close', 'Staff.add', 'Staff.remove', 'Toppings.list', 'Toppings.save',
    'Toppings.drop'].map((label) => {
    const v = add('method', label);
    join(v, parse, 'calls');
    return v;
  });
  const model = createModel({
    nodes,
    edges,
    rows: [],
    dicts: {
      types,
      repos: ['api'],
      kinds: [''],
      files: [''],
      edgeTypes,
      confidences: ['static'],
      meta: {},
      enumerated: [],
      values: [],
      reasons: [],
      levels: [],
      hints: [],
    },
  });
  return { model, route, create, provision, parse, roles, metrics, mint, elsewhere };
})();

group('expanding in the flow, and who else', () => {
  const { model: m, route, create, provision, parse, roles, metrics, mint, elsewhere } = shared;

  it('reads the table of which way a node looks in one place', () => {
    expect(LOOK[1]).toEqual({ flow: 'out', also: 'in' });
    expect(LOOK[-1]).toEqual({ flow: 'in', also: 'out' });
    expect(LOOK[0]).toEqual({ flow: 'both', also: null });
  });

  it('expands a helper on the right into what it reaches, never into its other callers', () => {
    const plain = neighbourhood(m, { focus: provision, hops: 1 });
    expect(plain.more.get(parse)).toBe(1);
    expect(plain.others.get(parse)).toEqual({ look: 'in', count: 8, shown: false });

    const hood = neighbourhood(m, { focus: provision, hops: 1, expanded: [parse] });
    expect(hood.layer.get(roles)).toBe(2);
    expect(hood.side.get(roles)).toBe(1);
    expect(hood.layer.has(mint)).toBe(false);
    for (const v of elsewhere) expect(hood.layer.has(v)).toBe(false);
    expect(hood.more.has(parse)).toBe(false);
    expect(hood.nodes).toHaveLength(4);
  });

  it('expands a node on the left into what reaches it, never into its other callees', () => {
    const plain = neighbourhood(m, { focus: provision, hops: 1 });
    expect(plain.more.get(create)).toBe(1);
    expect(plain.others.get(create)).toEqual({ look: 'out', count: 1, shown: false });

    const hood = neighbourhood(m, { focus: provision, hops: 1, expanded: [create] });
    expect(hood.layer.get(route)).toBe(-2);
    expect(hood.side.get(route)).toBe(-1);
    expect(hood.layer.has(metrics)).toBe(false);
  });

  it('expands the focus both ways', () => {
    expect(neighbourhood(m, { focus: provision, hops: 0 }).nodes).toEqual([provision]);
    const hood = neighbourhood(m, { focus: provision, hops: 0, expanded: [provision] });
    expect(hood.layer.get(create)).toBe(-1);
    expect(hood.layer.get(parse)).toBe(1);
    expect(hood.others.has(provision)).toBe(false);
  });

  it('does not show +N on a node whose only unseen neighbours are who else uses it', () => {
    const hood = neighbourhood(m, { focus: provision, hops: 2 });
    expect(hood.more.has(parse)).toBe(false);
    expect(hood.others.get(parse)!.count).toBe(8);
    expect(hood.more.has(create)).toBe(false);
    expect(hood.others.get(create)!.count).toBe(1);
  });

  it('draws who else uses a helper as context, grouped by class, beside the flow', () => {
    const hood = neighbourhood(m, { focus: provision, hops: 2, group: true, also: [parse] });
    expect(hood.layer.get(mint)).toBe(0);
    expect(hood.context.get(mint)).toEqual({ of: parse, look: 'in' });
    const groups = [...hood.groups.values()];
    expect(groups.map((g) => [g.owner, g.members.length])).toEqual([['Toppings', 3], ['Shifts', 2], ['Staff', 2]]);
    for (const g of groups) expect(hood.context.get(g.id)).toEqual({ of: parse, look: 'in' });
    // The flow itself is not context, and the count says how many there are.
    expect(hood.context.has(provision)).toBe(false);
    expect(hood.context.has(roles)).toBe(false);
    expect(hood.others.get(parse)).toEqual({ look: 'in', count: 8, shown: true });
    // Context is drawn with its edges, neither expands nor counts as more of the flow.
    expect(hood.edges.some((k) => m.edges[k]![0] === mint && m.edges[k]![1] === parse)).toBe(true);
    expect(hood.more.has(mint)).toBe(false);
    expect(hood.left).toBe(0);
    const expanded = neighbourhood(m, { focus: provision, hops: 2, group: true, also: [parse], expanded: [mint] });
    expect(expanded.nodes).toEqual(hood.nodes);
  });

  it('draws what else a caller on the left uses as context', () => {
    const hood = neighbourhood(m, { focus: provision, hops: 1, also: [create] });
    expect(hood.layer.get(metrics)).toBe(0);
    expect(hood.context.get(metrics)).toEqual({ of: create, look: 'out' });
  });

  it('has no who else on the focus', () => {
    const hood = neighbourhood(m, { focus: parse, hops: 1, also: [parse] });
    expect(hood.context.size).toBe(0);
  });
});

/**
 * A route behind two guards and an interceptor, and a table ten queries reach:
 * four from `OrderRepository` (known by the methods that make them), three from
 * a billing file, one from an audit file, and two from another service.
 */
const busy = (() => {
  const types = ['db_query', 'entry', 'guard', 'interceptor', 'method', 'table'];
  const edgeTypes = ['calls', 'guarded_by', 'handles', 'queries'];
  const nodes: unknown[][] = [];
  const edges: number[][] = [];
  const add = (type: string, label: string, repo = 0, file = 0): number => {
    nodes.push([types.indexOf(type), label, repo, 0, file, 1, 0]);
    return nodes.length - 1;
  };
  const join = (from: number, to: number, type: string) => edges.push([from, to, edgeTypes.indexOf(type), 0]);

  const route = add('entry', 'GET /orders');
  const handler = add('method', 'OrdersController.list');
  const auth = add('guard', 'AuthGuard');
  const roles = add('guard', 'RolesGuard');
  const log = add('interceptor', 'LoggingInterceptor');
  const verify = add('method', 'AuthService.verify');
  const table = add('table', 'orders');
  join(route, handler, 'handles');
  join(route, auth, 'guarded_by');
  join(route, roles, 'guarded_by');
  join(route, log, 'guarded_by');
  join(auth, verify, 'calls');

  const finders: number[] = [];
  const repoQueries: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const finder = add('method', `OrderRepository.find${i}`);
    const query = add('db_query', 'read orders', 0, 1);
    join(finder, query, 'calls');
    join(query, table, 'queries');
    finders.push(finder);
    repoQueries.push(query);
  }
  join(handler, finders[0]!, 'calls');
  const billing = [0, 1, 2].map(() => add('db_query', 'write orders', 0, 2));
  const audit = add('db_query', 'read orders', 0, 3);
  const sweeper = [0, 1].map(() => add('db_query', 'read orders', 1, 4));
  for (const query of [...billing, audit, ...sweeper]) join(query, table, 'queries');

  const model = createModel({
    nodes,
    edges,
    rows: [],
    dicts: {
      types,
      repos: ['api', 'jobs'],
      kinds: [''],
      files: ['', 'src/order.repository.ts', 'src/billing.service.ts', 'src/audit.ts', 'src/sweeper.ts'],
      edgeTypes,
      confidences: ['static'],
      meta: {},
      enumerated: [],
      values: [],
      reasons: [],
      levels: [],
      hints: [],
    },
  });
  return { model, route, handler, auth, roles, log, verify, table, finders, repoQueries, billing, audit, sweeper };
})();

const folded = { draw: false, unfolded: new Set<number>() };

group('folding the plumbing', () => {
  it('draws a route as one node, with what runs in front of it counted on a chip', () => {
    const hood = neighbourhood(busy.model, { focus: busy.route, hops: 2, fold: folded });
    expect(hood.nodes).toEqual([busy.route, busy.handler, busy.finders[0]]);
    expect(hood.chips.get(busy.route)).toEqual({
      open: false,
      layers: [['guard', 2], ['interceptor', 1]],
      total: 3,
    });
    // What a guard calls is not part of the flow either.
    expect(hood.layer.has(busy.verify)).toBe(false);
    expect(hood.more.has(busy.route)).toBe(false);
  });

  it('draws one node’s chain beside it when unfolded, and goes no further into it', () => {
    const hood = neighbourhood(busy.model, {
      focus: busy.handler,
      hops: 2,
      fold: { draw: false, unfolded: new Set([busy.route]) },
    });
    expect(hood.layer.get(busy.route)).toBe(-1);
    for (const wrapper of [busy.auth, busy.roles, busy.log]) expect(hood.layer.get(wrapper)).toBe(0);
    expect(hood.layer.has(busy.verify)).toBe(false);
    expect(hood.chips.get(busy.route)!.open).toBe(true);
    const wraps = hood.edges.filter((k) => busy.model.edges[k]![2] === 1);
    expect(wraps).toHaveLength(3);
  });

  it('walks them as nodes when asked to draw them', () => {
    const hood = neighbourhood(busy.model, { focus: busy.route, hops: 2, fold: { draw: true } });
    expect(hood.layer.get(busy.auth)).toBe(1);
    expect(hood.layer.get(busy.verify)).toBe(2);
    expect(hood.chips.size).toBe(0);
  });

  it('shows what a guard wraps when the guard is the focus', () => {
    const hood = neighbourhood(busy.model, { focus: busy.auth, hops: 1, fold: folded });
    expect(hood.layer.get(busy.route)).toBe(-1);
    expect(hood.chips.get(busy.route)!.total).toBe(2);
  });

  it('leaves the walk as it was without the option', () => {
    const fold = foldPlumbing(busy.model, { focus: busy.route });
    expect(fold.walk(1)).toBe(false);
    expect(neighbourhood(busy.model, { focus: busy.route, hops: 1 }).layer.has(busy.auth)).toBe(true);
  });
});

group('grouping busy neighbours', () => {
  const ids = (hood: ReturnType<typeof neighbourhood>) =>
    hood.nodes.filter((u): u is string => typeof u === 'string');

  it('groups by service, then by owning class, before the cap', () => {
    const hood = neighbourhood(busy.model, { focus: busy.table, hops: 1, cap: 3, group: true });
    const [api, jobs] = ids(hood).map((id) => hood.groups.get(id)!);
    expect(api).toMatchObject({ level: 'service', repo: 0, parts: 3 });
    expect(api!.members).toHaveLength(8);
    // A service whose queries all come from one class is that class at once.
    expect(jobs).toMatchObject({ level: 'class', repo: 1, owner: 'sweeper.ts' });
    expect(hood.left).toBe(0);
    expect(hood.edges).toEqual([]);
    expect(hood.bundles.map((b) => b.edges.length).sort()).toEqual([2, 8]);
  });

  it('counts a group as one against the cap, and says what the cap cut', () => {
    const hood = neighbourhood(busy.model, { focus: busy.table, hops: 1, cap: 2, group: true });
    expect(hood.nodes).toHaveLength(2);
    expect(hood.left).toBe(2);
  });

  it('opens a group in place, by its id, into the next level', () => {
    const closed = neighbourhood(busy.model, { focus: busy.table, hops: 2, group: true });
    const api = ids(closed)[0]!;
    // Behind the closed group: the methods that make the repository's queries.
    expect(closed.behind).toBe(4);

    const opened = new Set([api]);
    const once = neighbourhood(busy.model, { focus: busy.table, hops: 2, group: true, opened });
    const classes = ids(once).map((id) => once.groups.get(id)!);
    expect(classes.map((g) => [g.owner, g.members.length])).toEqual([
      ['OrderRepository', 4],
      ['billing.service.ts', 3],
      ['sweeper.ts', 2],
    ]);
    expect(once.layer.get(busy.audit)).toBe(-1);

    opened.add(classes[0]!.id);
    const twice = neighbourhood(busy.model, { focus: busy.table, hops: 2, group: true, opened });
    for (const query of busy.repoQueries) expect(twice.layer.get(query)).toBe(-1);
    for (const finder of busy.finders) expect(twice.layer.get(finder)).toBe(-2);
    expect(twice.behind).toBe(0);
  });

  it('shows the busiest classes and gathers the rest into one group that opens into the next page', () => {
    const paged = { at: 2, page: 2 };
    const api = ids(neighbourhood(busy.model, { focus: busy.table, hops: 1, group: paged }))[0]!;
    const opened = new Set([api]);
    const hood = neighbourhood(busy.model, { focus: busy.table, hops: 1, group: paged, opened });
    const [top, rest] = ids(hood).filter((id) => id.startsWith(api)).map((id) => hood.groups.get(id)!);
    expect(top).toMatchObject({ level: 'class', owner: 'OrderRepository' });
    expect(rest).toMatchObject({ level: 'rest', parts: 2 });
    expect(rest!.members).toHaveLength(4);

    opened.add(rest!.id);
    const next = neighbourhood(busy.model, { focus: busy.table, hops: 1, group: paged, opened });
    expect(ids(next).map((id) => next.groups.get(id)!.owner)).toContain('billing.service.ts');
    expect(next.layer.get(busy.audit)).toBe(-1);
  });

  it('leaves a quiet side alone', () => {
    const hood = neighbourhood(busy.model, { focus: busy.route, hops: 2, group: true, fold: folded });
    expect(hood.groups.size).toBe(0);
  });
});

group('the way to a hovered node', () => {
  it('reads back from the hovered unit to the focus, through a group or a node', () => {
    const closed = neighbourhood(busy.model, { focus: busy.table, hops: 2, group: true });
    const api = closed.nodes.find((u) => typeof u === 'string')!;
    expect(trace(closed, api)).toEqual([busy.table, api]);

    const repository = `${api}/c:OrderRepository`;
    const open = neighbourhood(busy.model, {
      focus: busy.table,
      hops: 2,
      group: true,
      opened: new Set([api, repository]),
    });
    expect(trace(open, busy.finders[2]!)).toEqual([busy.table, busy.repoQueries[2], busy.finders[2]]);
    expect(trace(open, busy.table)).toEqual([busy.table]);
    expect(trace(open, busy.verify)).toEqual([]);
  });
});

group('lanes', () => {
  it('gives each service a band, the focus’s first, as tall as its busiest column', () => {
    const hood = neighbourhood(busy.model, { focus: busy.table, hops: 1, group: true });
    const placed = layout(busy.model, hood, { row: 10, laneGap: 4, laneHead: 6 });
    expect(placed.lanes.map((lane) => [lane.repo, lane.y, lane.height])).toEqual([
      [0, 0, 16],
      [1, 20, 16],
    ]);
    const jobs = hood.nodes.find((u) => typeof u === 'string' && hood.groups.get(u)!.repo === 1)!;
    expect(placed.pos.get(jobs)!.y).toBe(26);
    expect(placed.height).toBe(36);
  });
});

group('how a node is written', () => {
  it('leads with what it is and follows with whose it is', () => {
    expect(labelParts(busy.model, busy.finders[1]!)).toEqual({ name: 'find1', owner: 'OrderRepository' });
    expect(labelParts(busy.model, busy.route)).toEqual({ name: 'GET /orders', owner: 'OrdersController' });
    expect(labelParts(busy.model, busy.repoQueries[0]!).owner).toBe('OrderRepository');
    expect(labelParts(busy.model, busy.billing[0]!).owner).toBe('billing.service.ts');
    expect(labelParts(busy.model, busy.table)).toEqual({ name: 'orders', owner: 'table' });
    expect(labelParts(busy.model, busy.auth)).toEqual({ name: 'AuthGuard', owner: 'guard' });
  });

  it('shortens in the middle, keeping both ends', () => {
    expect(middle('GET /api/admin/orders/:param', 12)).toBe('GET /a…param');
    expect(middle('GET /orders', 12)).toBe('GET /orders');
    expect(middle('anything', 1)).toBe('…');
  });

  it('names how near the camera is', () => {
    expect([0.3, 0.6, 1].map(zoomLevel)).toEqual(['far', 'mid', 'near']);
  });
});
