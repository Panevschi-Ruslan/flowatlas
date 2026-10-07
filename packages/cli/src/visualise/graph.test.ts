import { describe as group, expect, it } from 'vitest';
import {
  createFilter,
  createHistory,
  createModel,
  describe,
  formatHash,
  layout,
  neighbourhood,
  parseHash,
  search,
  step,
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
    // a callee, not part of the flow, and waits to be asked for.
    const hood = neighbourhood(model, { focus: 2, hops: 2 });
    expect(hood.layer.has(6)).toBe(false);
    expect(hood.more.get(3)).toBe(1);
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
    expect(hood.nodes.slice(1).map((v) => crowded.nodes[v]![1])).toEqual(['caller0', 'caller1', 'caller2']);
  });

  it('adds an expanded node’s neighbours on both sides, on top of the cap', () => {
    const hood = neighbourhood(model, { focus: 2, hops: 2, cap: 6, expanded: [3] });
    expect(hood.layer.get(6)).toBe(0);
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

  it('keeps the focus in the hash, and refuses a node the page does not have', () => {
    expect(formatHash(12, 2)).toBe('#graph/12/2');
    expect(parseHash('#graph/12/2', 20)).toEqual({ focus: 12, hops: 2 });
    expect(parseHash('#graph/12', 20)).toEqual({ focus: 12, hops: null });
    expect(parseHash('#graph/12/9', 20)).toEqual({ focus: 12, hops: null });
    expect(parseHash('#graph/20', 20)).toBeNull();
    expect(parseHash('#walk', 20)).toBeNull();
  });
});
