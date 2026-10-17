import { PROMPT_LIMITS, PROMPT_WALK, renderPrompt, type GraphEdge, type GraphNode } from '@flowatlas/core';
import type { AnchoredUnresolvedRow, DiffReport, LinkReport } from '@flowatlas/linker';
import { describe, expect, it } from 'vitest';
import { packBusiest } from './busiest.js';
import { packChanges, placeOfId } from './changes.js';
import { createModel, findEverything, type GraphModel } from './graph.js';
import { packGraph, type PackedGraph } from './pack.js';
import { promptAskOf, promptFor, promptScopesOf, promptTargetOf, stepBreakOf, stepsOf, subjectOf, type PromptTarget } from './steps.js';

/**
 * A synthetic shop for P73's views: a gateway route calls a client whose
 * outbound call finds no route on the orders side, a route with no handler,
 * a channel nobody consumes, and an orders route a client calls from two
 * gateway routes.
 */
const report = {
  httpOut: {}, channels: {}, routes: { total: 0, called: 0, duplicated: 0 }, types: {}, totals: {},
  services: [{ name: 'shop-gateway', type: 'nestjs' }, { name: 'shop-orders', type: 'nestjs' }],
} as unknown as LinkReport;

const n = (id: string, type: GraphNode['type'], repo: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id, type, repo, label: extra.label ?? id, file: 'src/a.ts', line: 1, ...extra,
});
const nodes: GraphNode[] = [
  n('entry:shop-gateway:http:POST:/carts/:param/void', 'entry', 'shop-gateway', { kind: 'http', label: 'POST /carts/:param/void' }),
  n('shop-gateway#CartsController.void', 'method', 'shop-gateway', { label: 'CartsController.void' }),
  n('shop-gateway#CartsClient.void', 'method', 'shop-gateway', { label: 'CartsClient.void' }),
  n('http_out:shop-gateway#src/carts.client.ts:9:3', 'http_out', 'shop-gateway', {
    label: 'POST /carts/:param/void', meta: { method: 'POST', path: '/carts/:param/void' },
  }),
  n('entry:shop-gateway:http:GET:/health', 'entry', 'shop-gateway', { kind: 'http', label: 'GET /health' }),
  n('channel:cart.voided', 'channel', 'shop-orders', { label: 'cart.voided' }),
  n('entry:shop-gateway:http:GET:/carts', 'entry', 'shop-gateway', {
    kind: 'http', label: 'GET /carts',
    meta: { fails: [{ status: 422, exception: 'CouponRejectedError', at: 'shop-gateway#CartsController.list', source: 'throw' }] },
  }),
  n('shop-gateway#CartsController.list', 'method', 'shop-gateway', { label: 'CartsController.list' }),
  n('table:shop-orders#carts', 'table', 'shop-orders', { label: 'carts' }),
];
const e = (from: number, to: number, type: GraphEdge['type']): GraphEdge => ({
  from: nodes[from]!.id, to: nodes[to]!.id, type, confidence: 'static',
});
const edges: GraphEdge[] = [
  e(0, 1, 'handles'),
  e(1, 2, 'calls'),
  e(2, 3, 'calls'),
  e(6, 7, 'handles'),
  e(7, 2, 'calls'),
];
const unresolved: AnchoredUnresolvedRow[] = [{
  node: nodes[3]!.id, service: 'shop-gateway', file: 'src/carts.client.ts', line: 9, reason: 'target-route-not-found',
  level: 'action', sites: 1, message: 'target service shop-orders has no route POST /carts/:param/void', hint: null,
}];

const pack = (): PackedGraph =>
  packGraph({ builtAt: '2026-01-01T00:00:00Z', nodes, edges, unresolved, report });
const modelOf = (data: PackedGraph): GraphModel => createModel(data) as GraphModel;

describe('where a chain breaks', () => {
  it('ends a call that found no route with a red row saying so, and the check row that says why', () => {
    const model = modelOf(pack());
    const { rows } = stepsOf(model, 0);
    const last = rows[rows.length - 1]!;
    expect(rows.map((row) => row.kind)).toEqual(['handler', 'service', 'service', 'http', 'break']);
    expect(last).toMatchObject({ node: 3, depth: 4, failure: true, inline: 'no route', reason: 'target-route-not-found' });
    expect(last.message).toContain('has no route');
  });

  it('marks a way in with no handler, and a channel with nothing after it', () => {
    const model = modelOf(pack());
    expect(stepsOf(model, 4).rows.map((row) => [row.kind, row.inline])).toEqual([['handler', ''], ['break', 'no handler']]);
    expect(stepBreakOf(model, 5)).toMatchObject({ say: 'no handler' });
  });

  it('leaves a step that goes on, or ends where it should, unmarked', () => {
    const model = modelOf(pack());
    expect(stepBreakOf(model, 1)).toBeNull();
    expect(stepBreakOf(model, 8)).toBeNull();
  });

  it('says the break in a prompt, as the gap it is (P97)', () => {
    const model = modelOf(pack());
    const text = promptFor(model, { entry: 0 }, { walk: PROMPT_WALK, render: renderPrompt, limits: PROMPT_LIMITS });
    expect(text).toMatch(/- `target-route-not-found` at shop-gateway `src\/carts.client.ts:9`: target service shop-orders has no route/);
  });
});

describe('a node’s wider prompts (P134)', () => {
  const kit = { walk: PROMPT_WALK, render: renderPrompt, limits: PROMPT_LIMITS };
  /** The shop with the class its controller's methods belong to, after every other node. */
  const withClass = (): GraphModel => modelOf(packGraph({
    builtAt: '2026-01-01T00:00:00Z',
    nodes: [...nodes, n('shop-gateway#CartsController', 'provider', 'shop-gateway', { label: 'CartsController' })],
    edges, unresolved, report,
  }));

  it('offers a method as itself, its class, its file and its service, as the server’s scopes name them', () => {
    const model = withClass();
    const provider = nodes.length;
    expect(promptScopesOf(model, 1)).toEqual([
      { scope: 'node', target: { node: 1 }, name: 'CartsController.void' },
      { scope: 'class', target: { class: provider }, name: 'CartsController' },
      { scope: 'file', target: { file: ['shop-gateway', 'src/a.ts'] }, name: 'src/a.ts' },
      { scope: 'service', target: { service: 'shop-gateway' }, name: 'shop-gateway' },
    ]);
    // A way in is itself as a way in; a method of no class known has no class scope.
    expect(promptScopesOf(model, 0)[0]).toEqual({ scope: 'node', target: { entry: 0 }, name: 'POST /carts/:param/void' });
    expect(promptScopesOf(modelOf(pack()), 1).map(({ scope }) => scope)).toEqual(['node', 'file', 'service']);
  });

  it('names each target as one word a control carries, and reads it back', () => {
    const targets: PromptTarget[] = [
      { entry: 0 }, { row: 3 }, { class: 9 }, { file: ['shop-gateway', 'src/a#b.ts'] }, { service: 'shop-gateway' }, { blind: 'payments' }, { blind: '' },
    ];
    for (const target of targets) {
      expect(promptTargetOf(promptAskOf(target))).toEqual(target);
    }
    expect(promptAskOf({ file: ['shop-gateway', 'src/a.ts'] })).toBe('file:shop-gateway#src/a.ts');
    expect(promptTargetOf('entry:')).toBeNull();
    expect(promptTargetOf('file:no-service')).toBeNull();
    expect(promptTargetOf('nothing')).toBeNull();
    // A service whose traffic left no blind spot in the pack is no check (P144).
    expect(subjectOf(withClass(), { blind: 'payments' }, kit)).toBeNull();
  });

  it('writes a service’s front: its ways in by kind and its most common gaps', () => {
    const text = promptFor(withClass(), { service: 'shop-gateway' }, kit);
    expect(text.startsWith('# Service: shop-gateway\n')).toBe(true);
    expect(text).toContain('## Ways in · 3\n\n- http · 3: `entry:shop-gateway:http:GET:/carts`, `entry:shop-gateway:http:GET:/health`, ' +
      '`entry:shop-gateway:http:POST:/carts/:param/void`');
    expect(text).toContain('- `target-route-not-found` ×1, first at `src/carts.client.ts:9`: target service shop-orders has no route');
    expect(text).toContain('- `findings({service: "shop-gateway"})`');
    expect(promptFor(withClass(), { service: 'nobody' }, kit)).toBe('');
    // A service needs the limits it names its first few by.
    expect(subjectOf(withClass(), { service: 'shop-gateway' }, { walk: PROMPT_WALK })).toBeNull();
  });
});

describe('one search over everything', () => {
  it('finds routes, tables and gaps by every word typed, a group at a time', () => {
    const model = modelOf(pack());
    const found = findEverything(model, 'carts');
    const keys = found.map((group) => group.key);
    expect(keys).toEqual(expect.arrayContaining(['routes', 'tables', 'gaps', 'classes']));
    const routes = found.find((group) => group.key === 'routes')!;
    expect(routes.hits.map((hit) => hit.label)).toEqual(['GET /carts', 'POST /carts/:param/void']);
    expect(found.find((group) => group.key === 'gaps')!.hits[0]).toMatchObject({ node: 3 });
    expect(found.find((group) => group.key === 'classes')!.hits.map((hit) => hit.label))
      .toEqual(['CartsClient', 'CartsController']);
    expect(findEverything(model, 'cart voided').map((group) => group.key)).toEqual(['channels', 'nodes']);
    expect(findEverything(model, '   ')).toEqual([]);
  });

  it('lists the nodes the Graph tab found, and a gap by its reason in words or as its code (P101)', () => {
    const model = modelOf(pack());
    const nodes = findEverything(model, 'carts').find((group) => group.key === 'nodes')!;
    expect(nodes.hits.map((hit) => hit.label)).toContain('GET /carts');
    expect(nodes.hits.every((hit) => hit.node >= 0 && hit.sub.startsWith('shop-'))).toBe(true);
    const said = (reason: string) => 'said ' + reason;
    const fresh = modelOf(pack());
    const gap = findEverything(fresh, 'carts', 8, said).find((group) => group.key === 'gaps')!.hits[0]!;
    expect(gap.sub.startsWith('said ' + gap.reason)).toBe(true);
    expect(findEverything(fresh, gap.reason!).map((group) => group.key)).toContain('gaps');
  });

  it('finds the ways in that fail with an exception, by its name or status, and opens the way in', () => {
    const model = modelOf(pack());
    const fails = findEverything(model, 'coupon').find((group) => group.key === 'fails')!;
    expect(fails.hits).toEqual([{ label: '422 CouponRejectedError', sub: 'GET /carts · shop-gateway', node: 6 }]);
    expect(findEverything(model, '422').map((group) => group.key)).toEqual(['fails']);
    // A way in's path finds the route, not every failure it has.
    expect(findEverything(model, 'carts').map((group) => group.key)).not.toContain('fails');
  });
});

describe('busiest methods', () => {
  it('ranks by edges pointing in, with the ways in that reach each one and how far', () => {
    const position = new Map(nodes.map((node, i) => [node.id, i]));
    const { rows, ranked } = packBusiest(nodes, edges, position);
    // `handles` is not a hotspot edge, so a controller method a route hands to ranks nowhere.
    expect(ranked).toBe(1);
    // CartsClient.void: two callers, both its own service's; two ways in; two steps from the nearest.
    expect(rows[0]).toEqual([2, 2, 2, 1, 2, 2]);
    expect(pack().busiest.rows[0]).toEqual(rows[0]);
  });
});

describe('changes', () => {
  const diff = {
    base: { ref: 'main', services: {} },
    head: { ref: null, services: {} },
    nodes: {
      added: ['entry:shop-orders:http:GET:/carts/today', 'shop-orders#Carts.today'],
      removed: ['entry:shop-orders:http:GET:/carts/:param', 'entry:shop-orders:http:DELETE:/carts'],
      changed: [], moved: [],
    },
    edges: {
      added: [],
      removed: [
        { from: 'http_out:shop-gateway#src/carts.client.ts:12:5', to: 'entry:shop-orders:http:GET:/carts/:param', type: 'hits' },
        { from: 'entry:shop-orders:http:DELETE:/carts', to: 'shop-orders#Carts.drop', type: 'handles' },
      ],
      changed: [],
    },
    types: {
      added: [], removed: [],
      changed: [{ id: 'type:Cart', name: 'Cart', baseHash: 'a', headHash: 'b', fieldDiff: [
        { field: 'total', change: 'type', optional: false, base: 'number', head: 'string', rule: null, message: 'total: number became string' },
      ] }],
    },
    counts: {
      base: { nodes: 10, edges: 9, types: 1, unresolved: { rows: 2, sites: 2 } },
      head: { nodes: 10, edges: 7, types: 1, unresolved: { rows: 3, sites: 3 } },
    },
    impact: [],
    contracts: { new: [{ severity: 'error', kind: 'field-type', message: 'Cart.total disagrees' }], fixed: [], preexisting: [], ignored: [] },
    warnings: [],
  } as unknown as DiffReport;

  it('lists routes added and removed, the removed ones still called, changed shapes and new gaps', () => {
    const packed = packChanges(diff);
    expect(packed.routes.added).toEqual([{ id: 'entry:shop-orders:http:GET:/carts/today', service: 'shop-orders', label: 'GET /carts/today' }]);
    expect(packed.routes.removed.map((route) => route.label)).toEqual(['GET /carts/:param', 'DELETE /carts']);
    expect(packed.stillCalled).toEqual([{
      id: 'entry:shop-orders:http:GET:/carts/:param', service: 'shop-orders', label: 'GET /carts/:param',
      callers: ['shop-gateway: src/carts.client.ts:12'],
    }]);
    expect(packed.shapes).toEqual([{ id: 'type:Cart', name: 'Cart', fields: ['total: number became string'] }]);
    expect(packed.gaps).toEqual([{ severity: 'error', kind: 'field-type', message: 'Cart.total disagrees' }]);
    expect(packed.unresolved).toEqual({ base: 2, head: 3 });
    expect(packed.base).toBe('main');
  });

  it('rides in the pack only when asked for', () => {
    expect(pack().changes).toBeUndefined();
    const changes = packChanges(diff);
    expect(packGraph({ builtAt: '', nodes, edges, unresolved, report, changes }).changes).toBe(changes);
  });

  it('reads an id as a place', () => {
    expect(placeOfId('http_out:shop-gateway#src/carts.client.ts:12:5')).toBe('shop-gateway: src/carts.client.ts:12');
    expect(placeOfId('entry:shop-orders:http:GET:/x')).toBe('entry:shop-orders:http:GET:/x');
  });
});
