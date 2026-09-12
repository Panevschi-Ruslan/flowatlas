import {
  SCHEMA_VERSION,
  parseConfig,
  type FlowatlasConfig,
  type GraphEdge,
  type GraphNode,
  type RepoGraph,
  type TypeEntry,
} from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { linkGraphs } from './link.js';
import type { TypeVersion } from './merge.js';

const FIXED = '2026-01-01T00:00:00.000Z';

const config = (over: Partial<Parameters<typeof parseConfig>[0]> = {}): FlowatlasConfig =>
  parseConfig({
    services: [
      { name: 'gateway', repo: './gateway', type: 'nestjs' },
      { name: 'orders', repo: './orders', type: 'nestjs', baseUrlEnv: ['ORDERS_URL'] },
    ],
    sharedPackages: ['@fx/contracts'],
    ...over,
  } as Parameters<typeof parseConfig>[0]);

const graph = (repo: string, over: Partial<RepoGraph> = {}): RepoGraph => ({
  schemaVersion: SCHEMA_VERSION,
  repo,
  generatedAt: FIXED,
  nodes: [],
  edges: [],
  types: {},
  unresolved: [],
  ...over,
});

const node = (id: string, repo: string, over: Partial<GraphNode> = {}): GraphNode => ({
  id,
  type: 'method',
  label: id,
  repo,
  ...over,
});

const route = (repo: string, method: string, path: string): GraphNode =>
  node(`entry:${repo}:http:${method}:${path}`, repo, {
    type: 'entry',
    kind: 'http',
    label: `${method} ${path}`,
    meta: { method, path },
  });

const call = (
  repo: string,
  id: string,
  meta: Record<string, unknown>,
): GraphNode => node(id, repo, { type: 'http_out', label: id, meta });

const edge = (from: string, to: string, type: GraphEdge['type']): GraphEdge => ({
  from,
  to,
  type,
  confidence: 'static',
});

const type = (over: Partial<TypeEntry> = {}): TypeEntry => ({
  name: 'OrderDto',
  kind: 'object',
  declaredIn: 'node_modules/@fx/contracts/index.d.ts',
  structuralHash: 'aaa',
  fields: [],
  ...over,
});

const link = (graphs: RepoGraph[], cfg = config()) =>
  linkGraphs(graphs, cfg, { builtAt: FIXED });

/** A gateway that calls one route on `orders`, with the caller wired up. */
const callerGraph = (over: { meta?: Record<string, unknown>; markers?: unknown[] } = {}) =>
  graph('gateway', {
    nodes: [
      node('gateway#client.ts:Client.fetch', 'gateway', {
        ...(over.markers === undefined ? {} : { meta: { markers: over.markers } }),
      }),
      call('gateway', 'http_out:gateway#client.ts:10:1', {
        method: 'GET',
        path: '/orders/:param',
        baseUrlEnv: 'ORDERS_URL',
        ...over.meta,
      }),
    ],
    edges: [edge('gateway#client.ts:Client.fetch', 'http_out:gateway#client.ts:10:1', 'calls')],
  });

const ordersGraph = () =>
  graph('orders', { nodes: [route('orders', 'GET', '/orders/:param')] });

describe('merging', () => {
  it('keeps one channel node for every repository that touches it', () => {
    const channel = (repo: string, adapter: string): GraphNode =>
      node('channel:order.created', repo, {
        type: 'channel',
        label: 'order.created',
        meta: { channelKind: 'topic', adapters: [adapter] },
      });
    const { project } = link([
      graph('orders', { nodes: [channel('orders', 'kafka')] }),
      graph('billing', { nodes: [channel('billing', 'rabbitmq')] }),
    ]);

    const channels = project.nodes.filter((item) => item.type === 'channel');
    expect(channels).toHaveLength(1);
    expect(channels[0]?.meta?.['adapters']).toEqual(['kafka', 'rabbitmq']);
  });

  it('reports an id two repositories both produced', () => {
    const clash = (repo: string, file: string): GraphNode =>
      node('shared#thing', repo, { file });
    const { project } = link([
      graph('orders', { nodes: [clash('orders', 'a.ts')] }),
      graph('billing', { nodes: [clash('billing', 'b.ts')] }),
    ]);

    const row = project.unresolved.find((item) => item.reason === 'duplicate-node-id');
    expect(row?.message).toBe('shared#thing was produced by both orders and billing');
    expect(project.nodes.filter((item) => item.id === 'shared#thing')).toHaveLength(1);
  });

  it('tags every unresolved row with the repository it came from', () => {
    const { project } = link([
      graph('orders', {
        unresolved: [{ file: 'a.ts', line: 1, reason: 'dynamic-channel-name' }],
      }),
    ]);
    expect(project.unresolved[0]?.service).toBe('orders');
  });

  it('sorts nodes, edges and types whatever order the repositories arrive in', () => {
    const graphs = [
      graph('orders', {
        nodes: [node('orders#b', 'orders'), node('orders#a', 'orders')],
        edges: [edge('orders#b', 'orders#a', 'calls')],
        types: { 'type:orders#B': type({ name: 'B' }), 'type:orders#A': type({ name: 'A' }) },
      }),
      graph('billing', { nodes: [node('billing#a', 'billing')] }),
    ];
    const forward = link(graphs);
    const backward = link([...graphs].reverse());

    expect(forward.project.nodes.map((item) => item.id)).toEqual([
      'billing#a',
      'orders#a',
      'orders#b',
    ]);
    expect(JSON.stringify(forward.project)).toBe(JSON.stringify(backward.project));
  });
});

describe('types from a shared package', () => {
  it('merges them into one entry and marks where they came from', () => {
    const shared = { 'type:@fx/contracts#OrderDto': type() };
    const { project, report } = link([
      graph('gateway', { types: shared }),
      graph('orders', { types: shared }),
    ]);

    expect(Object.keys(project.types)).toEqual(['type:@fx/contracts#OrderDto']);
    expect(project.types['type:@fx/contracts#OrderDto']?.meta?.['sharedPackage']).toBe(
      '@fx/contracts',
    );
    expect(report.types).toEqual({ total: 1, sharedPackage: 1 });
  });

  it('keeps both readings when two repositories disagree about the shape', () => {
    const { project } = link([
      graph('gateway', { types: { 'type:@fx/contracts#OrderDto': type({ structuralHash: 'aaa' }) } }),
      graph('orders', { types: { 'type:@fx/contracts#OrderDto': type({ structuralHash: 'bbb' }) } }),
    ]);

    const versions = project.types['type:@fx/contracts#OrderDto']?.meta?.[
      'versions'
    ] as TypeVersion[];
    expect(versions.map((item) => item.structuralHash)).toEqual(['aaa', 'bbb']);
  });

  it('leaves a type each repository declares for itself alone', () => {
    const { project, report } = link([
      graph('gateway', { types: { 'type:gateway#InvoiceDto': type({ name: 'InvoiceDto' }) } }),
      graph('orders', { types: { 'type:orders#InvoiceDto': type({ name: 'InvoiceDto' }) } }),
    ]);
    expect(Object.keys(project.types)).toHaveLength(2);
    expect(report.types.sharedPackage).toBe(0);
  });
});

describe('joining a call to a route', () => {
  it('follows the settings key the address is rooted at', () => {
    const { project, report } = link([callerGraph(), ordersGraph()]);
    const joined = project.edges.filter((item) => item.type === 'http_calls');

    expect(joined).toHaveLength(1);
    expect(joined[0]?.confidence).toBe('static');
    expect(joined[0]?.meta).toEqual({ via: 'baseUrlEnv', targetService: 'orders' });
    expect(report.httpOut.linked).toBe(1);
  });

  it('says which service was meant when the route is gone', () => {
    const gone = callerGraph({ meta: { method: 'POST', path: '/orders/:param/cancel' } });
    const { project, report } = link([gone, ordersGraph()]);

    expect(project.edges.filter((item) => item.type === 'http_calls')).toHaveLength(0);
    expect(report.httpOut.noRoute).toBe(1);
    expect(report.unresolved[0]?.reason).toBe('target-route-not-found');
    expect(report.unresolved[0]?.message).toBe(
      'target service orders has no route POST /orders/:param/cancel',
    );
  });

  it('names the verbs a path does answer when only the verb is wrong', () => {
    const wrongVerb = callerGraph({ meta: { method: 'DELETE' } });
    const { report } = link([wrongVerb, ordersGraph()]);
    expect(report.unresolved[0]?.hint).toContain('That path answers GET.');
  });

  it('refuses to guess when a settings key names no service', () => {
    const unknown = callerGraph({ meta: { baseUrlEnv: 'PAYMENTS_URL' } });
    const { report } = link([unknown, ordersGraph()]);

    expect(report.httpOut.unknownEnv).toBe(1);
    expect(report.unresolved[0]?.message).toBe('no service declares PAYMENTS_URL');
  });

  it('refuses to guess when two services claim the same settings key', () => {
    const both = parseConfig({
      services: [
        { name: 'gateway', repo: './gateway', type: 'nestjs' },
        { name: 'orders', repo: './orders', type: 'nestjs', baseUrlEnv: ['ORDERS_URL'] },
        { name: 'legacy', repo: './legacy', type: 'nestjs', baseUrlEnv: ['ORDERS_URL'] },
      ],
      sharedPackages: [],
    });
    const { report } = link([callerGraph(), ordersGraph()], both);

    expect(report.httpOut.unknownEnv).toBe(1);
    expect(report.unresolved[0]?.message).toBe('ORDERS_URL is declared on services orders and legacy');
  });

  it('refuses to choose between two routes that answer equally', () => {
    const ambiguous = callerGraph({ meta: { path: '/a/x/x' } });
    const twoWays = graph('orders', {
      nodes: [route('orders', 'GET', '/a/:param/x'), route('orders', 'GET', '/a/x/:param')],
    });
    const { project, report } = link([ambiguous, twoWays]);

    expect(project.edges.filter((item) => item.type === 'http_calls')).toHaveLength(0);
    expect(report.httpOut.ambiguous).toBe(1);
    expect(report.unresolved[0]?.reason).toBe('ambiguous-route');
  });

  it('takes the spelled-out route over the one with a hole, and says so', () => {
    const literal = callerGraph({ meta: { path: '/orders/latest' } });
    const both = graph('orders', {
      nodes: [route('orders', 'GET', '/orders/:param'), route('orders', 'GET', '/orders/latest')],
    });
    const { project } = link([literal, both]);
    const joined = project.edges.find((item) => item.type === 'http_calls');

    expect(joined?.to).toBe('entry:orders:http:GET:/orders/latest');
    expect(String(joined?.meta?.['note'])).toContain('entry:orders:http:GET:/orders/:param');
  });

  it('counts a call to a third party as such and joins nothing', () => {
    const third = callerGraph({ meta: { baseUrlEnv: undefined, host: 'api.stripe.com' } });
    const { report } = link([third, ordersGraph()]);
    expect(report.httpOut).toMatchObject({ total: 1, external: 1, linked: 0 });
  });

  it('counts a call whose address is built at run time as dynamic', () => {
    const dynamic = callerGraph({ meta: { baseUrlEnv: undefined, path: undefined } });
    const { report } = link([dynamic, ordersGraph()]);
    expect(report.httpOut).toMatchObject({ total: 1, dynamic: 1, linked: 0 });
  });
});

describe('an annotation that says where a call goes', () => {
  const marker = (service: string, route: string) => [{ name: 'CallsService', args: [service, route] }];

  it('joins a call no address could be read from', () => {
    const annotated = callerGraph({
      meta: { baseUrlEnv: undefined, path: undefined },
      markers: marker('orders', 'GET /orders/:param'),
    });
    const { project, report } = link([annotated, ordersGraph()]);
    const joined = project.edges.filter((item) => item.type === 'http_calls');

    expect(joined).toHaveLength(1);
    expect(joined[0]?.confidence).toBe('marker');
    expect(joined[0]?.meta?.['via']).toBe('marker');
    expect(report.httpOut).toMatchObject({ linked: 1, byMarker: 1, dynamic: 0 });
  });

  it('wins over what the settings key would have said, and adds no second edge', () => {
    const disagreeing = callerGraph({ markers: marker('orders', 'POST /orders') });
    const orders = graph('orders', {
      nodes: [route('orders', 'GET', '/orders/:param'), route('orders', 'POST', '/orders')],
    });
    const { project } = link([disagreeing, orders]);
    const joined = project.edges.filter((item) => item.type === 'http_calls');

    expect(joined).toHaveLength(1);
    expect(joined[0]?.to).toBe('entry:orders:http:POST:/orders');
  });

  it('falls back to the settings key when it names a service nobody configured', () => {
    const wrong = callerGraph({ markers: marker('nope', 'GET /orders/:param') });
    const { project, report } = link([wrong, ordersGraph()]);

    expect(project.edges.filter((item) => item.type === 'http_calls')).toHaveLength(1);
    expect(report.httpOut).toMatchObject({ linked: 1, byMarker: 0 });
    expect(report.unresolved.map((item) => item.reason)).toContain('marker-service-unknown');
  });

  it('falls back to the settings key when it names a route that is gone', () => {
    const wrong = callerGraph({ markers: marker('orders', 'GET /gone') });
    const { project, report } = link([wrong, ordersGraph()]);

    expect(project.edges.filter((item) => item.type === 'http_calls')).toHaveLength(1);
    expect(report.unresolved.map((item) => item.reason)).toContain('marker-route-not-found');
  });
});

describe('the report', () => {
  it('puts every outgoing call in exactly one bucket', () => {
    const gateway = graph('gateway', {
      nodes: [
        call('gateway', 'http_out:gateway#a', {
          method: 'GET',
          path: '/orders/:param',
          baseUrlEnv: 'ORDERS_URL',
        }),
        call('gateway', 'http_out:gateway#b', {
          method: 'POST',
          path: '/gone',
          baseUrlEnv: 'ORDERS_URL',
        }),
        call('gateway', 'http_out:gateway#c', { method: 'GET', path: '/x', baseUrlEnv: 'NOPE_URL' }),
        call('gateway', 'http_out:gateway#d', { method: 'GET', host: 'api.stripe.com' }),
        call('gateway', 'http_out:gateway#e', { method: 'GET' }),
      ],
    });
    const { httpOut } = link([gateway, ordersGraph()]).report;

    expect(httpOut.total).toBe(5);
    expect(
      httpOut.linked +
        httpOut.unknownEnv +
        httpOut.noRoute +
        httpOut.ambiguous +
        httpOut.external +
        httpOut.dynamic,
    ).toBe(httpOut.total);
    expect(httpOut.byMarker).toBeLessThanOrEqual(httpOut.linked);
  });

  it('accounts for every channel exactly once', () => {
    const channel = (repo: string, name: string): GraphNode =>
      node(`channel:${name}`, repo, { type: 'channel', label: name });
    const producer = node('orders#pub', 'orders', { type: 'producer' });
    const consumer = node('billing#sub', 'billing', { type: 'consumer' });
    const { report, project } = link([
      graph('orders', {
        nodes: [channel('orders', 'order.created'), channel('orders', 'order.archived'), producer],
        edges: [
          edge('orders#pub', 'channel:order.created', 'emits'),
          edge('orders#pub', 'channel:order.archived', 'emits'),
        ],
      }),
      graph('billing', {
        nodes: [channel('billing', 'order.created'), channel('billing', 'invoice.requested'), consumer],
        edges: [
          edge('channel:order.created', 'billing#sub', 'consumes'),
          edge('channel:invoice.requested', 'billing#sub', 'consumes'),
        ],
      }),
    ]);

    expect(report.channels.total).toBe(3);
    expect(report.channels.linked).toBe(1);
    expect(report.channels.noConsumers).toEqual(['channel:order.archived']);
    expect(report.channels.noProducers).toEqual(['channel:invoice.requested']);
    expect(
      report.channels.linked + report.channels.noConsumers.length + report.channels.noProducers.length,
    ).toBe(report.channels.total);
    expect(project.nodes.find((item) => item.id === 'channel:order.created')?.meta).toMatchObject({
      producers: 1,
      consumers: 1,
    });
  });

  it('lists the routes nothing reaches', () => {
    const { report } = link([
      callerGraph(),
      graph('orders', {
        nodes: [route('orders', 'GET', '/orders/:param'), route('orders', 'GET', '/quiet')],
      }),
    ]);
    expect(report.routes).toMatchObject({ total: 2, called: 1, uncalled: ['entry:orders:http:GET:/quiet'] });
  });

  it('lists a route two handlers claim', () => {
    const claimed = graph('orders', {
      nodes: [
        route('orders', 'GET', '/a/:param'),
        node('orders#one', 'orders'),
        node('orders#two', 'orders'),
      ],
      edges: [
        edge('entry:orders:http:GET:/a/:param', 'orders#one', 'handles'),
        edge('entry:orders:http:GET:/a/:param', 'orders#two', 'handles'),
      ],
    });
    expect(link([claimed]).report.routes.duplicated).toEqual(['entry:orders:http:GET:/a/:param']);
  });

  it('carries the services the configuration named, read or not', () => {
    const { project } = linkGraphs([ordersGraph()], config(), {
      builtAt: FIXED,
      services: [
        {
          name: 'gateway',
          repo: './gateway',
          type: 'angular',
          extractor: null,
          skipped: 'no-extractor',
          nodes: 0,
          edges: 0,
          types: 0,
          unresolved: 0,
          durationMs: 0,
        },
      ],
    });
    expect(project.services.find((item) => item.name === 'gateway')?.skipped).toBe('no-extractor');
  });
});

describe('a graph from an older version of the tool', () => {
  it('is refused rather than half read', () => {
    const stale = { ...graph('orders'), schemaVersion: SCHEMA_VERSION - 1 };
    expect(() => link([stale])).toThrow(
      `graph.json of orders is schema v${SCHEMA_VERSION - 1}, expected v${SCHEMA_VERSION}`,
    );
  });
});
