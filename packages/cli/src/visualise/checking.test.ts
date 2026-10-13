import { REVERSE_EDGES } from '@flowatlas/mcp';
import { describe as group, expect, it } from 'vitest';
import {
  createFilter,
  createModel,
  createProblems,
  describe,
  editorUrl,
  impactView,
  neighbourhood,
  onlyProblems,
  shortestPath,
  trace,
  upstream,
  UPSTREAM,
} from './graph.js';

/**
 * A packed graph written by hand, in the shape `packGraph` writes.
 *
 *   web:GET /orders ─hits→ GET /orders ─handles→ list ─calls→ find ─queries→ orders
 *                                                  ↑ calls      ↑ calls
 *                                               Cron.sweep   Audit.find ← GET /audit (handles)
 *   web:POST /pay (joins nothing)        a guard ─guarded_by─ none
 */
const types = ['entry', 'method', 'table', 'ui_api_call', 'ui_action'];
const repos = ['api', 'web'];
const edgeTypes = ['calls', 'guarded_by', 'handles', 'hits', 'queries'];
const confidences = ['heuristic', 'static'];
const T: Record<string, number> = { entry: 0, method: 1, table: 2, ui_api_call: 3, ui_action: 4 };
const E = { calls: 0, guarded_by: 1, handles: 2, hits: 3, queries: 4 } as const;
const S = 1;

// [type, label, repo, kind, file, line, meta]
const node = (type: string, label: string, repo = 0, file = 0, line = 0): unknown[] => [T[type], label, repo, 0, file, line, 0];

const NODES = [
  /* 0 */ node('ui_api_call', 'GET /orders', 1, 1, 5),
  /* 1 */ node('entry', 'GET /orders', 0, 2, 10),
  /* 2 */ node('method', 'OrdersService.list', 0, 3, 20),
  /* 3 */ node('method', 'OrdersRepo.find', 0, 4, 7),
  /* 4 */ node('table', 'orders'),
  /* 5 */ node('method', 'Cron.sweep', 0, 3, 90),
  /* 6 */ node('method', 'Audit.find', 0, 4, 30),
  /* 7 */ node('entry', 'GET /audit', 0, 2, 40),
  /* 8 */ node('ui_api_call', 'POST /pay', 1, 1, 9),
  /* 9 */ node('ui_action', 'click="load()"', 1, 1, 3),
  /* 10 */ node('entry', 'GET /health', 0, 2, 60),
  /* 11 */ node('method', 'AuthGuard.canActivate', 0, 5, 1),
];
const EDGES: number[][] = [
  /* 0 */ [0, 1, E.hits, S],
  /* 1 */ [1, 2, E.handles, S],
  /* 2 */ [2, 3, E.calls, 0],
  /* 3 */ [3, 4, E.queries, S],
  /* 4 */ [5, 2, E.calls, S],
  /* 5 */ [6, 3, E.calls, S],
  /* 6 */ [7, 6, E.handles, S],
  /* 7 */ [9, 0, E.calls, S],
  /* 8 */ [10, 11, E.guarded_by, S],
];
// [node, repo, file, line, reason, level, sites, message, hint]
const ROWS: unknown[][] = [
  /* 0 */ [3, 0, 4, 8, 0, 0, 1, 'receiver read by name only', 0],
  /* 1 */ [-1, 0, 4, 7, 1, 1, 3, 'a dynamic table name at find', -1],
  /* 2 */ [-1, 0, 4, 40, 1, 1, 1, 'elsewhere in the repo file', -1],
  /* 3 */ [-1, 1, 1, 5, 2, 1, 1, 'a path built at run time', -1],
  /* 4 */ [-1, 0, 2, 10, 3, 0, 1, 'route has no guard', -1],
];

const packed = (nodes: unknown[][] = NODES, edges: number[][] = EDGES, steps: number[] = []) => ({
  nodes,
  edges,
  rows: ROWS,
  steps,
  dicts: {
    types,
    repos,
    kinds: [''],
    files: ['', 'src/api.ts', 'src/orders.controller.ts', 'src/orders.service.ts', 'src/orders.repo.ts', 'src/auth.ts'],
    edgeTypes,
    confidences,
    meta: {} as Record<string, string>,
    enumerated: [] as string[],
    values: [] as string[],
    reasons: ['db-receiver-name-only', 'dynamic-table-name', 'api-path-dynamic', 'route-unguarded'],
    levels: ['action', 'info'],
    hints: ['name the class'],
  },
});

const model = createModel(packed());
const problems = createProblems(model);

group('problems', () => {
  it('counts rows naming a node and rows at its line, and says the two apart', () => {
    expect(problems.of(3)).toEqual({ on: [0], atLine: [1] });
    expect(problems.count(3)).toBe(2);
    expect(problems.badgesFor(3)).toEqual([
      { kind: 'rows', count: 1, title: '1 row names this node: db-receiver-name-only' },
      { kind: 'line', count: 1, title: '1 row at src/orders.repo.ts:7, naming no node: dynamic-table-name' },
    ]);
  });

  it('does not count a row elsewhere in the file, and has no badge for a node with none', () => {
    expect(problems.count(6)).toBe(0);
    expect(problems.badgesFor(6)).toEqual([]);
    expect(problems.has(2)).toBe(false);
  });

  it('never matches a row to a node without a line', () => {
    expect(problems.count(4)).toBe(0);
  });

  it('keeps the details panel’s three lists apart: naming it, at its line, elsewhere in its file', () => {
    const repo = describe(model, 3);
    expect(repo.rows).toEqual([0]);
    expect(repo.atLine).toEqual([1]);
    expect(repo.inFile).toEqual([2]);
  });

  it('lists ways in, crossings and calls with problems in one place', () => {
    const { waysIn, crossings, calls } = problems.list();
    // GET /health has no handler read; GET /orders has a row at its line.
    expect(waysIn).toEqual([
      { node: 10, rows: 0, unhandled: true },
      { node: 1, rows: 1, unhandled: false },
    ]);
    // The crossing from the browser call, which carries a row, to the route, which does too.
    expect(crossings).toEqual([{ edge: 0, rows: 2 }]);
    // GET /orders carries a row; POST /pay joined nothing.
    expect(calls).toEqual([
      { node: 0, rows: 1, unjoined: false },
      { node: 8, rows: 0, unjoined: true },
    ]);
  });

  it('cuts a drawing to the nodes with problems and the steps that join them to the focus', () => {
    const hood = neighbourhood(model, { focus: 5, hops: 3 });
    expect(hood.nodes.sort()).toEqual([2, 3, 4, 5]);
    const cut = onlyProblems(model, hood, problems.has);
    // `find` has problems; `list` stays as the step between it and the focus;
    // the table has none and goes.
    expect(cut.nodes.sort()).toEqual([2, 3, 5]);
    expect(cut.edges.sort()).toEqual([2, 4]);
    expect(cut.clean).toBe(1);
  });
});

group('the shortest path', () => {
  it('follows edges the way the calls run, one column per step', () => {
    const path = shortestPath(model, { from: 9, to: 4 });
    expect(path.found).toBe(true);
    expect(path.length).toBe(5);
    expect(path.paths).toBe(1);
    expect(path.nodes).toEqual([9, 0, 1, 2, 3, 4]);
    expect(Object.fromEntries(path.layer)).toEqual({ 9: 0, 0: 1, 1: 2, 2: 3, 3: 4, 4: 5 });
    expect(path.edges.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 7]);
    expect(path.focus).toBe(9);
    expect(path.left).toBe(0);
  });

  it('says no path, and what it searched, when the edges run the other way', () => {
    const none = shortestPath(model, { from: 4, to: 9, depth: 12 });
    expect(none.found).toBe(false);
    expect(none.searched).toBe(1);
    expect(none.depth).toBe(12);
    expect(none.nodes).toEqual([4, 9]);
    expect(none.edges).toEqual([]);
  });

  it('walks edges either way when asked, and finds every shortest path', () => {
    // From the cron job to the audit route: sweep → list → find ← Audit.find ← GET /audit.
    expect(shortestPath(model, { from: 5, to: 7 }).found).toBe(false);
    const either = shortestPath(model, { from: 5, to: 7, directed: false });
    expect(either.found).toBe(true);
    expect(either.nodes).toEqual([5, 2, 3, 6, 7]);
    // A diamond is two shortest paths.
    const nodes = ['a', 'b', 'c', 'd'].map((label) => node('method', label));
    const diamond = createModel(packed(nodes, [
      [0, 1, E.calls, S],
      [0, 2, E.calls, S],
      [1, 3, E.calls, S],
      [2, 3, E.calls, S],
    ]));
    const both = shortestPath(diamond, { from: 0, to: 3 });
    expect(both.paths).toBe(2);
    expect(both.nodes).toEqual([0, 1, 2, 3]);
  });

  it('stops at the depth it was given', () => {
    expect(shortestPath(model, { from: 9, to: 4, depth: 4 }).found).toBe(false);
    expect(shortestPath(model, { from: 9, to: 4, depth: 5 }).found).toBe(true);
  });

  it('respects the filters, except at the two ends', () => {
    const noCalls = createFilter(model, { edgeTypes: new Set([E.calls]) });
    expect(shortestPath(model, { from: 9, to: 4, filter: noCalls }).found).toBe(false);
    const webHidden = createFilter(model, { services: new Set([1]) });
    // The path starts in the hidden service, which was asked for; the browser
    // call it goes through is hidden, so there is no way out of it.
    expect(shortestPath(model, { from: 9, to: 4, filter: webHidden }).found).toBe(false);
    expect(shortestPath(model, { from: 0, to: 4, filter: webHidden }).found).toBe(true);
  });

  it('draws one whole path first when the paths are over the cap', () => {
    // A ladder: every rung doubles the shortest paths.
    const rungs = 6;
    const nodes = [node('method', 'start')];
    const edges: number[][] = [];
    let previous = [0];
    for (let r = 0; r < rungs; r += 1) {
      const pair = [nodes.length, nodes.length + 1];
      nodes.push(node('method', `r${r}a`), node('method', `r${r}b`));
      for (const p of previous) for (const q of pair) edges.push([p, q, E.calls, S]);
      previous = pair;
    }
    const end = nodes.length;
    nodes.push(node('method', 'end'));
    for (const p of previous) edges.push([p, end, E.calls, S]);
    const ladder = createModel(packed(nodes, edges));
    const path = shortestPath(ladder, { from: 0, to: end, cap: 9 });
    expect(path.paths).toBe(2 ** rungs);
    expect(path.nodes).toHaveLength(9);
    expect(path.left).toBe(nodes.length - 9);
    // The first eight drawn are one path from start to end, by label.
    expect(path.nodes.slice(0, rungs + 2).map((v) => ladder.nodes[v]![1])).toEqual([
      'start', 'r0a', 'r1a', 'r2a', 'r3a', 'r4a', 'r5a', 'end',
    ]);
  });
});

group('impact', () => {
  it('walks the impact command’s edges, no other', () => {
    expect([...UPSTREAM].sort()).toEqual([...REVERSE_EDGES].sort());
  });

  it('finds everything upstream, the ways in among it, and where the chain stops', () => {
    const found = upstream(model, 4);
    expect(found.reached).toBe(8);
    expect(found.entries).toEqual([7, 1]);
    expect(found.doors).toEqual([7, 1, 9]);
    expect(found.withoutEntry).toEqual([1]);
    expect(found.depth).toBe(8);
    // A guard reaches nothing a walk back follows.
    expect(found.dist.has(10)).toBe(false);
  });

  it('keeps a depth given as given', () => {
    const near = upstream(model, 4, { depth: 2 });
    expect([...near.dist.keys()].sort((a, b) => a - b)).toEqual([2, 3, 4, 6]);
    expect(near.entries).toEqual([]);
  });

  it('goes one hop further for every step of a chain it climbs', () => {
    // A chain of ten steps, each the one before it, the last calling a handler.
    const nodes = [node('entry', 'workflow'), ...Array.from({ length: 10 }, (_, s) => node('method', `step${s}`)), node('method', 'handler')];
    const edges: number[][] = [[0, 1, E.handles, S]];
    for (let s = 1; s < 10; s += 1) edges.push([s, s + 1, E.calls, S]);
    edges.push([10, 11, E.calls, S]);
    const flat = createModel(packed(nodes, edges));
    expect(upstream(flat, 11).entries).toEqual([]);
    const chained = createModel(packed(nodes, edges, Array.from({ length: 10 }, (_, s) => s + 1)));
    const found = upstream(chained, 11);
    expect(found.entries).toEqual([0]);
    expect(found.depth).toBe(18);
  });

  it('draws every way in first, joined down to the node, under the cap', () => {
    const found = upstream(model, 4);
    const view = impactView(model, found, { cap: 8 });
    for (const door of found.doors) expect(view.layer.has(door)).toBe(true);
    expect(view.nodes).toHaveLength(8);
    expect(view.left).toBe(1);
    expect(view.layer.get(4)).toBe(0);
    expect(view.layer.get(1)).toBe(-3);
    expect(view.layer.get(9)).toBe(-5);
    // The cron job is nearer than the browser's action, and still the one left
    // out, and `list` says one of its callers is not drawn.
    expect(view.layer.has(5)).toBe(false);
    expect(view.more.get(2)).toBe(1);
    const expanded = impactView(model, found, { cap: 8, expanded: [2] });
    expect(expanded.layer.get(5)).toBe(-3);
    expect(expanded.more.has(2)).toBe(false);
  });
});

group('a question drawn as a neighbourhood is', () => {
  it('cut to its problems group by group: a group stays when a member has one', () => {
    // A table queried from seven methods of one class, one with a row on it,
    // and from seven browser calls with none: two groups around the focus.
    const nodes = [
      node('table', 'orders'),
      ...Array.from({ length: 7 }, (_, n) => node('method', `Repo.q${n}`, 0, 4, 100 + n)),
      ...Array.from({ length: 7 }, (_, n) => node('ui_api_call', `GET /e${n}`, 1, 1, 200 + n)),
    ];
    const edges = nodes.slice(1).map((_, n) => [n + 1, 0, E.queries, S]);
    const busy = createModel(packed(nodes, edges));
    const hood = neighbourhood(busy, { focus: 0, hops: 1, group: true });
    expect(hood.groups.size).toBe(2);
    const cut = onlyProblems(busy, hood, createProblems(busy).has);
    expect([...cut.groups.values()].map((g) => g.members.includes(3))).toEqual([true]);
    expect(cut.nodes).toEqual([0, ...cut.groups.keys()]);
    expect(cut.bundles.every((b) => cut.layer.has(b.from) && cut.layer.has(b.to))).toBe(true);
    expect(cut.clean).toBe(1);
  });

  it('a path that a hover can trace back to its start, with plumbing folded on it', () => {
    const guarded = createModel(packed(NODES, [...EDGES, [1, 11, E.guarded_by, S]]));
    const path = shortestPath(guarded, { from: 9, to: 4, fold: {} });
    expect(trace(path, 4)).toEqual([9, 0, 1, 2, 3, 4]);
    expect(path.groups.size).toBe(0);
    expect(path.bundles).toEqual([]);
    expect(path.chips.get(1)).toEqual({ open: false, layers: [['wrapper', 1]], total: 1 });
    expect(path.layer.has(11)).toBe(false);
    // Unfolded, the guard is drawn beside the way in it wraps.
    const unfolded = shortestPath(guarded, { from: 9, to: 4, fold: { unfolded: new Set([1]) } });
    expect(unfolded.layer.get(11)).toBe(unfolded.layer.get(1)! + 1);
    expect(unfolded.edges).toContain(EDGES.length);
    expect(shortestPath(guarded, { from: 9, to: 4 }).chips.size).toBe(0);
  });

  it('an impact walk that a hover traces from the node changed out to a way in', () => {
    const view = impactView(model, upstream(model, 4));
    expect(trace(view, 9)).toEqual([4, 3, 2, 1, 0, 9]);
    expect(view.groups.size).toBe(0);
  });
});

group('editor links', () => {
  it('builds a link each editor opens, at the line', () => {
    expect(editorUrl('vscode', '/home/me/api', 'src/a.ts', 12)).toBe('vscode://file/home/me/api/src/a.ts:12');
    expect(editorUrl('cursor', '/home/me/api/', './src/a.ts', 3)).toBe('cursor://file/home/me/api/src/a.ts:3');
    expect(editorUrl('idea', '/home/me/api', 'src/a.ts', 12)).toBe('idea://open?file=%2Fhome%2Fme%2Fapi%2Fsrc%2Fa.ts&line=12');
    expect(editorUrl('file', '/home/me/api', 'src/a.ts', 12)).toBe('file:///home/me/api/src/a.ts');
  });

  it('escapes what would end the link, and keeps a drive letter', () => {
    expect(editorUrl('vscode', '/home/me/my api#2', 'src/a b?.ts', 1)).toBe(
      'vscode://file/home/me/my%20api%232/src/a%20b%3F.ts:1',
    );
    expect(editorUrl('vscode', 'C:\\work\\api', 'src\\a.ts', 4)).toBe('vscode://file/C:/work/api/src/a.ts:4');
    expect(editorUrl('idea', 'C:\\work\\api', 'src/a.ts', 4)).toBe('idea://open?file=C%3A%2Fwork%2Fapi%2Fsrc%2Fa.ts&line=4');
  });

  it('leaves the line off when there is none, and gives nothing without an editor, a root or a file', () => {
    expect(editorUrl('vscode', '/r', 'a.ts', 0)).toBe('vscode://file/r/a.ts');
    expect(editorUrl('emacs', '/r', 'a.ts', 1)).toBeNull();
    expect(editorUrl('toString', '/r', 'a.ts', 1)).toBeNull();
    expect(editorUrl('vscode', null, 'a.ts', 1)).toBeNull();
    expect(editorUrl('vscode', '/r', '', 1)).toBeNull();
  });
});
