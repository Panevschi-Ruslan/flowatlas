import { NODE_TYPES, PROMPT_LIMITS, PROMPT_WALK, renderPrompt, type GraphEdge, type GraphNode } from '@flowatlas/core';
import type { LinkReport } from '@flowatlas/linker';
import { describe, expect, it } from 'vitest';
import { createKeys } from './frame.js';
import { answersOf, createModel, type GraphModel } from './graph.js';
import { createMap, mapCallOrder, mapGuessesConfirmed, mapSeenCount, mapTopTargets, mapView } from './map.js';
import { packGraph, type PackedGraph } from './pack.js';
import { packSites } from './sites.js';
import {
  acceptCommandForLike,
  acceptCommandForPlace,
  accessOf,
  createSeen,
  doctorCommandForReason,
  failChipLines,
  failChips,
  failChipsSeen,
  failGroups,
  failSeenSay,
  failSay,
  failsOf,
  likeRoute,
  promptFor,
  scheduleOf,
  STEP_KINDS,
  STEP_MODES,
  stepIdOf,
  stepKindOf,
  stepsOf,
  stepUnits,
  subjectOf,
} from './steps.js';

/**
 * What the page hands the prompt: the walk's bounds and core's renderer, as the
 * Steps panel (`panels/steps-ui.js`) does (P97).
 */
const kit = { walk: PROMPT_WALK, render: renderPrompt, limits: PROMPT_LIMITS };

/**
 * A synthetic shop: a route calls a service that reads a table, publishes to
 * a channel a worker consumes, and calls a payments host; a guessed call and
 * a failure destination hang off the service.
 */
const report = {
  httpOut: {}, channels: {}, routes: { total: 0, called: 0, duplicated: 0 }, types: {}, totals: {},
  services: [{ name: 'shop-api', type: 'nestjs' }, { name: 'shop-worker', type: 'nestjs' }],
} as unknown as LinkReport;

const n = (id: string, type: GraphNode['type'], repo: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id, type, repo, label: extra.label ?? id, file: 'src/a.ts', line: 1, ...extra,
});
const nodes: GraphNode[] = [
  n('entry:shop-api:http:POST:/orders', 'entry', 'shop-api', { kind: 'http', label: 'POST /orders', line: 4 }),
  n('shop-api#Orders.place', 'method', 'shop-api', { label: 'Orders.place', line: 10 }),
  n('db:shop-api#1', 'db_query', 'shop-api', { label: 'insert', line: 12, meta: { table: 'orders', op: 'write' } }),
  n('table:shop-api#orders', 'table', 'shop-api', { label: 'orders' }),
  n('producer:shop-api#1', 'producer', 'shop-api', { label: 'publish order.created', line: 14 }),
  n('channel:order.created', 'channel', 'shop-api', { label: 'order.created' }),
  n('consumer:shop-worker#1', 'consumer', 'shop-worker', { label: 'onOrderCreated' }),
  n('shop-api#Orders.guess', 'method', 'shop-api', { label: 'Orders.guess', line: 20 }),
  n('shop-api#Orders.onFail', 'method', 'shop-api', { label: 'Orders.onFail', line: 30 }),
];
const e = (from: number, to: number, type: GraphEdge['type'], over: Partial<GraphEdge> = {}): GraphEdge => ({
  from: nodes[from]!.id, to: nodes[to]!.id, type, confidence: 'static', ...over,
});
const edges: GraphEdge[] = [
  e(0, 1, 'handles'),
  e(1, 4, 'calls', { line: 14 }),
  e(1, 2, 'calls', { line: 12 }),
  e(2, 3, 'queries'),
  e(4, 5, 'emits'),
  e(5, 6, 'consumes'),
  e(1, 7, 'calls', { line: 20, confidence: 'heuristic', meta: { concurrent: true } }),
  e(1, 8, 'triggers', { line: 30, meta: { when: 'failure' } }),
];

const pack = (): PackedGraph => packGraph({ builtAt: '2026-01-01T00:00:00Z', nodes, edges, unresolved: [], report });
const modelOf = (data: PackedGraph): GraphModel => createModel(data) as GraphModel;

describe('sites', () => {
  it('orders by a workflow place or the line, and marks failures and declared side-by-side steps', () => {
    const sites = packSites(edges);
    expect(sites.order[1]).toBe(14);
    expect(sites.failure).toEqual([7]);
    expect(sites.concurrent).toEqual([6]);
    const branch = packSites([e(1, 2, 'calls', { meta: { order: 0, transitions: [{ kind: 'branch' }] } }),
      e(1, 3, 'calls', { meta: { order: 1, transitions: [{ kind: 'catch' }] } })]);
    expect(branch).toEqual({ order: [0, 1], failure: [1], concurrent: [0], loop: [], ordered: [[0, 0], [1, 0]] });
  });
});

describe('steps', () => {
  it('walks depth first in call order, with inline tables and channels, guesses and failure paths', () => {
    const data = pack();
    const model = modelOf(data);
    const { rows } = stepsOf(model, 0, { answersOf });
    const labels = rows.map((row) => `${row.depth}:${model.nodes[row.node]![1]}`);
    expect(labels).toEqual([
      '0:POST /orders', '1:Orders.place', '2:insert', '3:orders', '2:publish order.created',
      '3:order.created', '4:onOrderCreated', '2:Orders.guess', '2:Orders.onFail',
    ]);
    expect(rows[2]!.inline).toBe('write orders');
    expect(rows[2]!.kind).toBe('db');
    expect(rows[5]!.kind).toBe('channel');
    expect(rows[6]!.crosses).toBe(true);
    expect(rows[7]!).toMatchObject({ certain: false, together: true, failure: false });
    expect(rows[8]!.failure).toBe(true);
  });

  it('stops at its depth and counts what it left', () => {
    const model = modelOf(pack());
    const found = stepsOf(model, 0, { depth: 1 });
    expect(found.rows).toHaveLength(2);
    expect(found.more).toBe(4);
    expect(found.cut).toEqual({ depth: 4, rows: 0 });
  });

  it('says what the rows a waterfall holds left out, apart from the depth', () => {
    const found = stepsOf(modelOf(pack()), 0, { rows: 3 });
    expect(found.rows).toHaveLength(3);
    expect(found.cut.depth).toBe(0);
    expect(found.cut.rows).toBeGreaterThan(0);
    expect(found.more).toBe(found.cut.rows);
  });
});

describe('steps on a waterfall, in steps not time (P99)', () => {
  const at = (rows: Array<{ node: number; start: number; span: number }>, node: number) => {
    const row = rows.find((r) => r.node === node)!;
    return [row.start, row.span];
  };

  it('gives a step nothing runs under one unit, a parent its children, end to end in call order', () => {
    const { rows } = stepsOf(modelOf(pack()), 0);
    // place → insert, publish, guess (side by side, alone in its run), onFail (on failure).
    expect(at(rows, 0)).toEqual([0, 4]);
    expect(at(rows, 1)).toEqual([0, 4]);
    expect(at(rows, 2)).toEqual([0, 1]);
    expect(at(rows, 3)).toEqual([0, 1]);
    expect(at(rows, 4)).toEqual([1, 1]);
    expect(at(rows, 6)).toEqual([1, 1]);
    expect(at(rows, 7)).toEqual([2, 1]);
    // A failure path is a step like any other, drawn in the bad tone.
    expect(rows.find((row) => row.node === 8)).toMatchObject({ failure: true, start: 3, span: 1 });
  });

  it('starts side-by-side siblings at one x, as wide as the widest', () => {
    const together = edges.map((edge, k) => (k === 7 ? { ...edge, meta: { ...edge.meta, concurrent: true } } : edge));
    const data = packGraph({ builtAt: '2026-01-01T00:00:00Z', nodes, edges: together, unresolved: [], report });
    const { rows } = stepsOf(modelOf(data), 0);
    expect(at(rows, 7)).toEqual([2, 1]);
    expect(at(rows, 8)).toEqual([2, 1]);
    expect(at(rows, 1)).toEqual([0, 3]);
  });

  it('draws what runs nothing - a loop, a repeat, an answer, a break - as a mark of no width', () => {
    type UnitRow = Parameters<typeof stepUnits>[0][number];
    const rows: UnitRow[] = [
      { parent: -1, kind: 'handler', together: false, again: false, loop: false, start: 0, span: 0 },
      { parent: 0, kind: 'answer', together: false, again: false, loop: false, start: 0, span: 0 },
      { parent: 0, kind: 'service', together: false, again: false, loop: false, start: 0, span: 0 },
      { parent: 2, kind: 'service', together: false, again: false, loop: true, start: 0, span: 0 },
      { parent: 0, kind: 'service', together: false, again: true, loop: false, start: 0, span: 0 },
      { parent: 0, kind: 'db', together: false, again: false, loop: false, start: 0, span: 0 },
    ];
    expect(stepUnits(rows)).toBe(2);
    expect(rows.map((row) => [row.start, row.span])).toEqual([[0, 2], [0, 0], [0, 1], [0, 0], [1, 0], [1, 1]]);
    // A way in with one step draws one bar.
    const one: UnitRow[] = [{ parent: -1, kind: 'handler', together: false, again: false, loop: false, start: 0, span: 0 }];
    expect(stepUnits(one)).toBe(1);
  });

  it('lists a setting a step reads as a leaf under it, each time it is read, and leaves it out when asked', () => {
    const withConfig = [...nodes, n('config:shop-api:ORDERS_LIMIT', 'config_key', 'shop-api', { label: 'ORDERS_LIMIT', line: 0 })];
    const reads = [...edges, {
      from: nodes[1]!.id, to: 'config:shop-api:ORDERS_LIMIT', type: 'reads_config', confidence: 'static', line: 11,
    } as GraphEdge, { from: nodes[7]!.id, to: 'config:shop-api:ORDERS_LIMIT', type: 'reads_config', confidence: 'static', line: 21 } as GraphEdge];
    const data = packGraph({ builtAt: '2026-01-01T00:00:00Z', nodes: withConfig, edges: reads, unresolved: [], report });
    const model = modelOf(data);
    const { rows } = stepsOf(model, 0);
    const settings = rows.filter((row) => row.kind === 'config');
    expect(settings).toHaveLength(2);
    expect(settings.every((row) => !row.again && !row.loop && row.logs.length === 0)).toBe(true);
    // Never walked: nothing is listed under a setting.
    for (const row of settings) expect(rows.some((other) => other.parent === rows.indexOf(row))).toBe(false);
    expect(rows[rows.indexOf(settings[0]!) - 1]!.node).toBe(1);
    const lean = stepsOf(model, 0, { config: false }).rows;
    expect(lean.some((row) => row.kind === 'config')).toBe(false);
    expect(lean.map((row) => row.node)).toEqual(rows.filter((row) => row.kind !== 'config').map((row) => row.node));
  });

  it('has a word and a glyph for every kind of step any node is', () => {
    const every = NODE_TYPES.map((type, i) => n(`${type}:x#${i}`, type, 'shop-api', type === 'entry' ? { kind: 'http' } : {}));
    every.push(n('entry:x:invoke', 'entry', 'shop-api', { kind: 'invoke' }), n('entry:x:wf', 'entry', 'shop-api', { kind: 'workflow' }),
      n('fn:x:state', 'function', 'shop-api', { kind: 'state' }));
    const model = modelOf(packGraph({ builtAt: '2026-01-01T00:00:00Z', nodes: every, edges: [], unresolved: [], report }));
    const kinds = new Set(every.map((_, i) => stepKindOf(model, i)));
    for (const kind of kinds) expect(STEP_KINDS, kind).toHaveProperty(kind);
    expect(kinds).toEqual(new Set(['handler', 'service', 'db', 'http', 'channel', 'view', 'act', 'config', 'other', 'lambda', 'workflow']));
    expect(new Set(Object.values(STEP_KINDS).map((kind) => kind.glyph)).size).toBe(Object.keys(STEP_KINDS).length);
    expect(STEP_MODES).toEqual(['compact', 'detailed', 'waterfall']);
  });
});

describe('observed', () => {
  const observed = (data: PackedGraph, keys: ReturnType<typeof createKeys>) => ({
    joins: {
      '2': { count: 5, lastSeen: '2026-01-02' },
      '4': { count: 3, lastSeen: '2026-01-03' },
      // A stable-key join is nothing the pack writes, and is not read.
      [`${keys.keyOf(0)}>${keys.keyOf(1)}:handles`]: { count: 9, lastSeen: '2026-01-04' },
      '02': { count: 9, lastSeen: '2026-01-04' },
      [String(data.edges.length)]: { count: 9, lastSeen: '2026-01-04' },
    },
    entries: { [nodes[0]!.id]: { hits: 7 }, [keys.keyOf(1)]: { hits: 9 } },
    unmatched: [['shop-api', 'http', 'GET /health']] as Array<[string, string, string]>,
    ambiguous: [[-1, 'symbol', 'CartService.add', 2, [1, 2], 3]] as Array<[number, string, string, number, number[], number]>,
  });

  it('is nothing when absent', () => {
    const data = pack();
    const seen = createSeen(data);
    expect(seen.any).toBe(false);
    expect(seen.ambiguous).toEqual([]);
    expect(stepsOf(modelOf(data), 0, { seen }).rows.every((row) => row.seen === 0)).toBe(true);
  });

  it('marks seen joins on the steps, hits on the entry, and keeps what matched nothing or several', () => {
    const data = pack();
    const keys = createKeys(data.keys, data.nodes.length);
    data.observed = observed(data, keys);
    const seen = createSeen(data);
    const { rows } = stepsOf(modelOf(data), 0, { seen });
    expect(rows[0]!.seen).toBe(7);
    expect(rows.find((row) => row.edge === 2)!.seen).toBe(5);
    expect(rows.find((row) => row.edge === 4)!.seen).toBe(3);
    expect(seen.join(0)).toBeNull();
    expect(seen.entry(1)).toBe(0);
    expect(seen.most).toBe(5);
    expect(seen.unmatched).toEqual([{ service: 'shop-api', kind: 'http', name: 'GET /health' }]);
    expect(seen.ambiguous).toEqual([{ kind: 'symbol', name: 'CartService.add', count: 2, places: [1, 2], unnamed: 3 }]);
    const map = createMap(data.map);
    const view = mapView(map, { toggled: new Set(), hidden: new Set() }, data.dicts.confidences);
    const total = view.links.reduce((sum, link) => sum + mapSeenCount(map, link, seen.join), 0);
    expect(total).toBe(3);
  });

  it('says a best guess traffic went through, and a way in it never touched (P110)', () => {
    const data = pack();
    const guess = data.edges.findIndex((edge) => data.dicts.confidences[edge[3]!] === 'heuristic');
    const entry = data.entryIds[nodes[0]!.id]!;
    data.observed = {
      joins: { [String(guess)]: { count: 4, lastSeen: '2026-01-02' } },
      entries: {},
      unmatched: [['shop-api', 'http', 'GET /health', 'list_entries({service: "shop-api"})']],
      never: { window: '7d', rows: [[entry, 1]] },
      confirmed: [guess],
    };
    const seen = createSeen(data);
    expect(seen.window).toBe('7d');
    expect(seen.confirmed(guess)).toBe(4);
    expect(seen.confirmed(0)).toBe(0);
    expect(seen.neverSeen).toEqual([{ node: entry, strong: true }]);
    expect(seen.unmatched[0]).toMatchObject({ next: 'list_entries({service: "shop-api"})' });
    const { rows } = stepsOf(modelOf(data), entry, { seen });
    expect(rows[0]!.never).toEqual({ window: '7d', strong: true });
    expect(rows.find((row) => row.edge === guess)).toMatchObject({ certain: false, seen: 4, confirmed: 4 });
    expect(rows.filter((row) => row.confirmed > 0)).toHaveLength(1);
    // The map draws a link solid when every best guess behind it was seen.
    const map = createMap(data.map);
    const view = mapView(map, { toggled: new Set(), hidden: new Set() }, data.dicts.confidences);
    const isGuess = (k: number) => data.dicts.confidences[data.edges[k]![3]!] === 'heuristic';
    const solid = view.links.filter((link) => mapGuessesConfirmed(map, link, isGuess, (k) => seen.confirmed(k) > 0));
    const dashed = view.links.filter((link) => mapGuessesConfirmed(map, link, isGuess, () => false));
    expect(dashed).toEqual([]);
    expect(solid.length).toBeLessThanOrEqual(1);
    // Without the file, nothing is confirmed and nothing is never seen.
    const bare = createSeen(pack());
    expect(bare.confirmed(guess)).toBe(0);
    expect(bare.never(entry)).toBeNull();
  });

  it('says how many fields a way in’s bodies differ from its code in, and which (P113)', () => {
    const data = pack();
    const entry = data.entryIds[nodes[0]!.id]!;
    data.observed = {
      joins: {},
      entries: {},
      unmatched: [],
      drift: { [nodes[0]!.id]: [2, ['request giftNote', '200 owner']], 'entry:nowhere:http:GET:/x': [1, ['request x']] },
    };
    const seen = createSeen(data);
    expect(seen.drift(entry)).toEqual({ fields: 2, paths: ['request giftNote', '200 owner'] });
    expect(seen.drift(entry + 1)).toBeNull();
    expect(createSeen(pack()).drift(entry)).toBeNull();
  });
});

describe('prompt', () => {
  it('names every node by its id, which the pack ships less what the node already says (P97)', () => {
    const model = modelOf(pack());
    expect(nodes.map((_, i) => stepIdOf(model, i))).toEqual(nodes.map((node) => node.id));
  });

  it('gathers a way in as the server does: its walk in call order, ids, places, marks', () => {
    const model = modelOf(pack());
    const subject = subjectOf(model, { entry: 0 }, kit)!;
    expect(subject).toMatchObject({ id: 'entry:shop-api:http:POST:/orders', type: 'entry', kind: 'http', service: 'shop-api', loc: 'src/a.ts:4' });
    expect(subject.steps.map((step) => `${step.depth}:${step.label}`)).toEqual([
      '1:Orders.place', '2:insert', '3:orders', '2:publish order.created', '3:order.created', '4:onOrderCreated',
      '2:Orders.guess', '2:Orders.onFail',
    ]);
    expect(subject.steps[6]).toMatchObject({ via: { type: 'calls', confidence: 'heuristic' }, marks: { together: true } });
    expect(subject.steps[7]).toMatchObject({ via: { type: 'triggers' }, marks: { failure: true } });
    const text = promptFor(model, { entry: 0 }, kit);
    expect(text).toContain('# Way in: POST /orders');
    expect(text).toContain('`entry:shop-api:http:POST:/orders`');
    expect(text).toContain('**insert** `db:shop-api#1` — shop-api `src/a.ts:12`');
    expect(text).toContain('[best guess, side by side]');
    expect(text).toContain('[on failure]');
    const short = promptFor(model, { entry: 0 }, { ...kit, limits: { ...PROMPT_LIMITS, maxChars: 500 } });
    expect(short.length).toBeLessThanOrEqual(500);
    expect(short).toMatch(/more line\(s\) cut to stay under 500 characters/);
  });

  it('gathers a channel with what publishes onto it and what consumes it', () => {
    const model = modelOf(pack());
    const subject = subjectOf(model, { channel: 5 }, kit)!;
    expect(subject.producers!.map((step) => step.id)).toEqual(['producer:shop-api#1']);
    expect(subject.steps.map((step) => step.id)).toEqual(['consumer:shop-worker#1']);
    expect(promptFor(model, { channel: 5 }, kit)).toContain('## Consumed by · 1');
  });

  it('gathers a check row as its gap id, every row of it, and the ways in that reach it', () => {
    const data = packGraph({
      builtAt: '2026-01-01T00:00:00Z', nodes, edges, report,
      unresolved: [
        { service: 'shop-api', file: 'src/a.ts', line: 12, reason: 'channel-dynamic', level: 'action', sites: 1, message: 'second', hint: 'Annotate it.', node: nodes[1]!.id },
        { service: 'shop-api', file: 'src/a.ts', line: 3, reason: 'channel-dynamic', level: 'action', sites: 1, message: 'first', hint: null, node: null },
      ] as never,
    });
    const subject = subjectOf(modelOf(data), { row: 0 }, kit)!;
    expect(subject).toMatchObject({ id: 'gap:shop-api|src/a.ts|channel-dynamic', type: 'check', kind: 'action', service: 'shop-api', loc: 'src/a.ts' });
    expect(subject.check!.places.map((place) => [place.loc, place.message, place.on?.id])).toEqual([
      ['src/a.ts:3', 'first', undefined],
      ['src/a.ts:12', 'second', 'shop-api#Orders.place'],
    ]);
    expect(subject.reachedFrom!.map((step) => step.id)).toEqual(['entry:shop-api:http:POST:/orders']);
    expect(subjectOf(modelOf(data), { row: 9 }, kit)).toBeNull();
  });
});

describe('map in call order', () => {
  it('puts the channel between its two apps and the store under its app', () => {
    const data = pack();
    const map = createMap(data.map);
    const view = mapView(map, { toggled: new Set(), hidden: new Set() }, data.dicts.confidences);
    const laid = mapCallOrder(map, view);
    const x = (id: string) => laid.placed.get(id)!.x;
    expect(x('service:shop-api')).toBeLessThan(x('channel:order.created'));
    expect(x('channel:order.created')).toBeLessThan(x('service:shop-worker'));
    const data_ = [...laid.placed.entries()].find(([id]) => id.startsWith('data:'));
    if (data_) expect(data_[1]).toMatchObject({ under: 'service:shop-api' });
    expect(mapTopTargets(data, 'shop-api').channels.map((t) => t.node)).toEqual([5]);
  });
});

describe('failures, loops, logs and schedules on the steps (P74)', () => {
  const at = (id: string, type: GraphNode['type'], extra: Partial<GraphNode> = {}): GraphNode =>
    n(id, type, 'shop-api', extra);
  const list: GraphNode[] = [
    at('entry:shop-api:http:POST:/carts', 'entry', {
      kind: 'http', label: 'POST /carts',
      meta: { fails: [
        { status: 409, exception: 'ConflictException', at: 'shop-api#Carts.add', file: 'src/carts.ts', line: 21, source: 'throw' },
        { status: 401, exception: 'AuthGuard', at: 'entry:shop-api:http:POST:/carts', source: 'guard' },
        { exception: 'Error', at: 'shop-api#helper', source: 'throw' },
      ] },
    }),
    at('shop-api#Carts.add', 'method', { label: 'Carts.add', line: 15,
      meta: { logs: [{ level: 'log', text: 'adding {count} items', at: 16 }, { level: 'error', at: 22 }] } }),
    at('db:shop-api#2', 'db_query', { label: 'find', line: 18, meta: { table: 'items', op: 'read' } }),
    at('entry:shop-api:cron:nightly', 'entry', { kind: 'cron', label: 'cron nightly',
      meta: { expression: '0 3 * * *', timeZone: 'Europe/Paris' } }),
  ];
  const linked: GraphEdge[] = [
    { from: list[0]!.id, to: list[1]!.id, type: 'handles', confidence: 'static' },
    { from: list[1]!.id, to: list[2]!.id, type: 'calls', confidence: 'static', line: 18, meta: { inLoop: { kind: 'for-of', line: 17 } } },
  ];
  const data = packGraph({
    builtAt: '2026-01-01T00:00:00Z', nodes: list, edges: linked, report,
    unresolved: [
      { service: 'shop-api', file: 'src/a.ts', line: 18, reason: 'query-in-loop', level: 'nothing', sites: 1,
        message: 'A database query runs once per item of a `for-of` loop: likely N+1.', hint: null, node: list[1]!.id },
    ] as never,
  });
  const model = modelOf(data);

  it('packs the loop, the logs and the schedule compactly', () => {
    expect(data.sites.loop).toEqual([[1, 'for-of', 17]]);
    expect(data.logs).toEqual({ 1: [['log', 16, 'adding {count} items'], ['error', 22]] });
    expect(scheduleOf(model, 3)).toEqual({ expression: '0 3 * * *', zone: 'Europe/Paris' });
    expect(scheduleOf(model, 0)).toBeNull();
  });

  it('says the statuses once each, lowest first, then the exceptions with none', () => {
    expect(failChips(failsOf(model, 0))).toEqual(['401', '409', 'Error']);
    expect(failsOf(model, 3)).toEqual([]);
  });

  it('groups each status and exception once with how many places raise it, and draws an assumed status as 500? (P87)', () => {
    const fail = (over: object) => ({ s: 500, x: 'Error', at: 1, src: 'throw' as const, ...over });
    const groups = failGroups([fail({ a: 1 }), fail({ a: 1, l: 4 }), fail({ s: 404, x: 'Missing' }), fail({ s: 404, x: 'Missing', src: 'guard' })]);
    expect(groups.map((group) => [group.s, group.x, group.a, group.n, group.srcs])).toEqual([
      [404, 'Missing', undefined, 2, ['throw', 'guard']],
      [500, 'Error', 1, 2, ['throw']],
    ]);
    expect(failChips([fail({ a: 1 }), fail({ s: 404 })])).toEqual(['404', '500?']);
    expect(failChips([fail({ a: 1 }), fail({})])).toEqual(['500']);
  });

  it('writes the doctor line for one reason, its service only when every row is in it (P141)', () => {
    expect(doctorCommandForReason('type-unresolved', ['gateway', 'gateway'], 60))
      .toBe('flowatlas doctor --reason type-unresolved --max-nodes 60 --service gateway');
    expect(doctorCommandForReason('type-unresolved', ['gateway', 'orders'], 60))
      .toBe('flowatlas doctor --reason type-unresolved --max-nodes 60');
    // A row that names no service is not in the one the others are in.
    expect(doctorCommandForReason('call-dynamic', ['gateway', ''], 3)).toBe('flowatlas doctor --reason call-dynamic --max-nodes 3');
    expect(doctorCommandForReason('call-dynamic', ['shop api'], 3)).toBe("flowatlas doctor --reason call-dynamic --max-nodes 3 --service 'shop api'");
  });

  it('says how many lines a failure line wraps to, a whole chip to the next line (P137)', () => {
    const chips = ['409 never seen', '500 ×1 not declared'];
    // Wide enough for all of it, or not laid out yet: one line.
    expect(failChipLines('can fail with ', chips, 1000)).toBe(1);
    expect(failChipLines('can fail with ', chips, 0)).toBe(1);
    // A phone's list (P137's 390px): the second chip goes to a line of its own rather than being cut.
    expect(failChipLines('can fail with ', chips, 300)).toBe(2);
    // Narrower than a chip and its neighbour: a line each, the lead on its own.
    expect(failChipLines('can fail with ', chips, 150)).toBe(3);
    expect(failChipLines('', ['404'], 40)).toBe(1);
  });

  it('sets what traffic answered beside each failure chip, and says it in the copied prompt (P106)', () => {
    const window = { from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z' };
    const seenData = packGraph({
      builtAt: '2026-01-01T00:00:00Z', nodes: list, edges: linked, report, unresolved: [],
      observed: {
        joins: {}, symbols: {}, channels: {}, unmatched: [], ambiguous: [], window,
        entries: { [list[0]!.id]: { hits: 30, lastSeen: null, statuses: { '201': 20, '401': 4, '500': 6 } } },
      } as never,
    });
    const seenModel = modelOf(seenData);
    const seen = createSeen(seenData);
    const compared = seen.failures(0);
    expect(compared).toMatchObject({ hits: 30, window, declaredSeen: [{ status: 401, exception: 'AuthGuard', count: 4 }] });
    expect(seen.failures(3)).toBeNull();
    expect(failChipsSeen(failsOf(seenModel, 0), compared).map((chip) => [chip.text, chip.mark])).toEqual([
      ['401 seen ×4', 'seen'],
      ['409 never seen', 'never'],
      ['Error', ''],
      ['500 ×6 not declared', 'undeclared'],
    ]);
    // Without traffic, the chips are what the code says, unmarked.
    expect(failChipsSeen(failsOf(seenModel, 0), null).map((chip) => chip.text)).toEqual(['401', '409', 'Error']);
    const groups = failGroups(failsOf(seenModel, 0));
    expect(groups.map((group) => failSeenSay(group, compared))).toEqual(['seen ×4', 'never seen', '']);
    const text = promptFor(seenModel, { node: 0 }, { ...kit, seen });
    expect(text).toContain('## Failures seen at run time · 30 hits, 2026-01-01T00:00:00.000Z to 2026-01-02T00:00:00.000Z');
    expect(text).toContain('- **500** ×6, 20% of requests — not declared; maybe `Error`, which name no status');
    expect(text).toContain('- **401** `AuthGuard` — declared, seen ×4');
    expect(text).toContain('- **409** `ConflictException` — declared, never seen in the window — at `src/carts.ts:21`');
    expect(promptFor(seenModel, { node: 0 }, kit)).not.toContain('Failures seen at run time');
  });

  it('marks the step that throws, the call per item and the likely N+1, and carries the logs', () => {
    const { rows } = stepsOf(model, 0);
    const add = rows.find((row) => row.node === 1)!;
    expect(add.throws.map((f) => f.s)).toEqual([409]);
    expect(add.logs).toEqual([{ level: 'log', line: 16, text: 'adding {count} items' }, { level: 'error', line: 22, text: '' }]);
    expect(rows[0]!.throws.map((f) => f.s)).toEqual([401]);
    const find = rows.find((row) => row.node === 2)!;
    expect(find.perItem).toBe('for-of');
    expect(find.nPlusOne).toBe(true);
    expect(add.perItem).toBe('');
  });

  it('does not call a loop that is per item on purpose a likely N+1 (P89)', () => {
    const noted = packGraph({
      builtAt: '2026-01-01T00:00:00Z', nodes: list, edges: linked, report,
      unresolved: [
        { service: 'shop-api', file: 'src/a.ts', line: 17, reason: 'query-in-loop', level: 'info', sites: 1,
          message: 'A `for-of` loop runs 1 database query once per item, each a conditional write or a send to one recipient: per item on purpose.',
          hint: null, node: list[1]!.id, meta: { severity: 'note', waysIn: 1 } },
      ] as never,
    });
    expect(noted.busiest.loops).toEqual([]);
    const find = stepsOf(modelOf(noted), 0).rows.find((row) => row.node === 2)!;
    expect(find.perItem).toBe('for-of');
    expect(find.nPlusOne).toBe(false);
  });

  it('copies the failures and the logs into the prompt', () => {
    const text = promptFor(model, { entry: 0 }, kit);
    expect(text).toContain('## Can fail with 401 · 409 · Error');
    expect(text).toContain('- **409** `ConflictException` — throw at `src/carts.ts:21`');
    expect(text).toContain('per item (for-of), likely N+1');
    expect(text).toContain('throws 409 ConflictException');
    expect(text).toContain('- logs log `adding {count} items` at line 16');
    expect(promptFor(model, { entry: 3 }, kit)).toContain('- schedule: `0 3 * * *` in Europe/Paris');
  });
});

describe('who covers a way in, and accepting every gap like one (P76)', () => {
  const guarded = nodes.map((node, index) =>
    index === 0
      ? {
          ...node,
          meta: {
            access: {
              guards: [{ id: 'g', name: 'JwtAuthGuard', layer: 'guard', where: 'global', via: 'APP_GUARD in AuthModule', skippedBy: 'Public' }],
              optOuts: [{ decorator: 'Public', key: 'isPublic', public: true, skips: ['JwtAuthGuard'], where: 'route' }],
            },
          },
        }
      : node,
  );
  const data = packGraph({ builtAt: '2026-01-01T00:00:00Z', nodes: guarded, edges, unresolved: [], report });

  it('packs what stands in front of a way in, and the prompt says it', () => {
    const model = modelOf(data);
    expect(accessOf(model, 0)).toEqual({
      g: [['JwtAuthGuard', 'global', 'APP_GUARD in AuthModule', 'Public']],
      o: [['Public', 1, 'route', 'JwtAuthGuard']],
    });
    expect(accessOf(model, 1)).toBeNull();
    const text = promptFor(model, { entry: 0 }, kit);
    expect(text).toContain('## In front of it');
    expect(text).toContain('- JwtAuthGuard · the whole application (APP_GUARD in AuthModule), switched off by @Public');
    expect(text).toContain('- @Public on this route, open on purpose; JwtAuthGuard reads it');
  });

  it('writes the accept command for one place: a route by its route, any other row by its file (P100)', () => {
    const route = { reason: 'route-unguarded', service: 'inventory', file: 'src/levels.controller.ts', line: 14,
      message: 'GET /levels/:param/low has no guard in front of it.' };
    expect(acceptCommandForPlace(route)).toBe(
      "flowatlas accept route-unguarded --service inventory --path 'GET /levels/:param/low' --note '<why this one is fine>'");
    const place = { reason: 'channel-dynamic', service: 'billing', file: 'src/billing/notify.ts', line: 31, message: 'a channel built at run time' };
    expect(acceptCommandForPlace(place)).toBe(
      "flowatlas accept channel-dynamic --service billing --file src/billing/notify.ts --note '<why this one is fine>'");
    // A row with no single place names only its service.
    expect(acceptCommandForPlace({ reason: 'service-read-nothing', service: 'billing', file: '' })).toBe(
      "flowatlas accept service-read-nothing --service billing --note '<why this one is fine>'");
    // A route reason whose message names no route is taken by its file.
    expect(acceptCommandForPlace({ ...route, message: 'no route here' })).toContain('--file src/levels.controller.ts');
    expect(acceptCommandForPlace({ reason: 'r', service: "it's", file: 'a b.ts' })).toBe(
      "flowatlas accept r --service 'it'\\''s' --file 'a b.ts' --note '<why this one is fine>'");
  });

  it('writes the accept command for every row like one as a rule that ends in --dry-run (P100)', () => {
    expect(likeRoute({ method: 'GET', path: '/levels/summary' })).toBe('GET /levels/*');
    expect(likeRoute({ method: 'GET', path: '/health' })).toBe('GET /health');
    const route = { reason: 'route-unguarded', service: 'inventory', file: 'src/levels.controller.ts', line: 14,
      message: 'GET /levels/:param/low has no guard in front of it.' };
    expect(acceptCommandForLike(route)).toBe(
      "flowatlas accept route-unguarded --service inventory --path 'GET /levels/:param/*' --note '<why these are fine>' --dry-run");
    expect(acceptCommandForLike({ reason: 'channel-dynamic', service: 'billing', file: 'src/billing/notify.ts' })).toBe(
      "flowatlas accept channel-dynamic --service billing --file 'src/billing/*' --note '<why these are fine>' --dry-run");
    // No rule takes more than the place: a route one segment deep, a file at the top, no file at all.
    expect(acceptCommandForLike({ ...route, message: 'GET /health has no guard in front of it.' })).toBeNull();
    expect(acceptCommandForLike({ reason: 'channel-dynamic', service: 'billing', file: 'main.ts' })).toBeNull();
    expect(acceptCommandForLike({ reason: 'service-read-nothing', service: 'billing' })).toBeNull();
  });
});


describe('a throw through a helper, as the page says it (P90)', () => {
  const helper = {
    x: 'toHttpError', at: -1, src: 'throw' as const, v: 'helper' as const,
    ch: [{ s: 401, x: 'UnauthorizedException' }, { s: 403, x: 'ForbiddenException' }, { s: 500, x: 'Locked', a: 1 as const }],
  };

  it('names the helper with what it can choose, and chips each status', () => {
    expect(failSay(helper)).toBe('toHttpError (401 | 403 | 500?)');
    expect(failSay({ x: 'reject', at: -1, src: 'throw', v: 'helper', fam: 'auth' })).toBe('reject (refuses who is asking)');
    expect(failChips([helper, { s: 404, x: 'NotFoundException', at: -1, src: 'throw' }])).toEqual(['401', '403', '404', '500?']);
    expect(failChips([{ x: 'reject', at: -1, src: 'throw', v: 'helper' }])).toEqual(['reject']);
  });
});
