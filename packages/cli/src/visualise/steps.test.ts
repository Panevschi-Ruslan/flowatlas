import type { GraphEdge, GraphNode } from '@flowatlas/core';
import type { LinkReport } from '@flowatlas/linker';
import { describe, expect, it } from 'vitest';
import { createKeys } from './frame.js';
import { answersOf, createModel, type GraphModel } from './graph.js';
import { createMap, mapCallOrder, mapSeenCount, mapTopTargets, mapView } from './map.js';
import { packGraph, type PackedGraph } from './pack.js';
import { packSites } from './sites.js';
import { acceptCommandFor, accessOf, createSeen, failChips, failsOf, likeRoute, promptFor, scheduleOf, stepsOf } from './steps.js';

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
    expect(branch).toEqual({ order: [0, 1], failure: [1], concurrent: [0], loop: [] });
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
});

describe('prompt', () => {
  it('writes the steps with places, marks, gaps and ids, within its bound', () => {
    const data = pack();
    const model = modelOf(data);
    const keys = createKeys(data.keys, data.nodes.length);
    const kit = { keyOf: keys.keyOf, idOf: (i: number) => (i === 0 ? nodes[0]!.id : null) };
    const text = promptFor(model, { entry: 0 }, kit);
    expect(text).toContain('# Way in: POST /orders');
    expect(text).toContain('`entry:shop-api:http:POST:/orders`');
    expect(text).toContain('`shop-api: src/a.ts:12`');
    expect(text).toContain('best guess: heuristic');
    expect(text).toContain('on failure');
    const short = promptFor(model, { entry: 0 }, { ...kit, chars: 200 });
    expect(short.length).toBeLessThan(300);
    expect(short).toMatch(/more lines cut/);
    expect(promptFor(model, { channel: 5 }, kit)).toContain('## Consumed by · 1');
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

  it('copies the failures and the logs into the prompt', () => {
    const text = promptFor(model, { entry: 0 }, { keyOf: (i) => 'k' + i });
    expect(text).toContain('## Can fail with 401 · 409 · Error');
    expect(text).toContain('- 409 `ConflictException` (throw) in `Carts.add` at `src/carts.ts:21`');
    expect(text).toContain('per item (for-of), likely N+1');
    expect(text).toContain('throws 409 ConflictException');
    expect(text).toContain('- logs log `adding {count} items` at line 16');
    expect(promptFor(model, { entry: 3 }, { keyOf: (i) => 'k' + i })).toContain('- schedule: `0 3 * * *` in Europe/Paris');
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
    const keys = createKeys(data.keys, data.nodes.length);
    const text = promptFor(model, { entry: 0 }, { keyOf: keys.keyOf, idOf: () => null });
    expect(text).toContain('## In front of it');
    expect(text).toContain('- JwtAuthGuard · the whole application (APP_GUARD in AuthModule), switched off by @Public');
    expect(text).toContain('- @Public on this route, open on purpose; JwtAuthGuard reads it');
  });

  it('writes the accept command for the routes beside one, quoted for a shell', () => {
    expect(likeRoute({ method: 'GET', path: '/levels/summary' })).toBe('GET /levels/*');
    expect(likeRoute({ method: 'GET', path: '/health' })).toBe('GET /health');
    expect(
      acceptCommandFor({ reason: 'route-unguarded', service: 'inventory', message: 'GET /levels/:param/low has no guard in front of it.' }),
    ).toBe("flowatlas accept route-unguarded --service inventory --path 'GET /levels/:param/*' --note '<why these are fine>'");
    expect(acceptCommandFor({ reason: 'channel-dynamic', service: 'billing' })).toBe(
      "flowatlas accept channel-dynamic --service billing --note '<why these are fine>'",
    );
    expect(acceptCommandFor({ reason: 'r', service: "it's" })).toContain("--service 'it'\\''s'");
  });
});

