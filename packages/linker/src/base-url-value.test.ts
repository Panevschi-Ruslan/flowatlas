import {
  ENVIRONMENT_META,
  SCHEMA_VERSION,
  parseConfig,
  type GraphEdge,
  type GraphNode,
  type RepoGraph,
  type RepoSettings,
} from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { serviceNamed } from './base-url-value.js';
import { linkGraphs } from './link.js';

const FIXED = '2026-01-01T00:00:00.000Z';

const config = (extra: Record<string, unknown> = {}) =>
  parseConfig({
    services: [
      { name: 'storefront', repo: './storefront', type: 'nestjs' },
      { name: 'orders', repo: './orders', type: 'nestjs' },
      { name: 'payments', repo: './payments', type: 'nestjs' },
      { name: 'web', repo: './web', type: 'react' },
    ],
    ...extra,
  } as Parameters<typeof parseConfig>[0]);

const graph = (repo: string, nodes: GraphNode[], edges: GraphEdge[] = []): RepoGraph => ({
  schemaVersion: SCHEMA_VERSION,
  repo,
  generatedAt: FIXED,
  nodes,
  edges,
  types: {},
  unresolved: [],
});

const route = (repo: string, method: string, path: string): GraphNode => ({
  id: `entry:${repo}:http:${method}:${path}`,
  type: 'entry',
  kind: 'http',
  label: `${method} ${path}`,
  repo,
  meta: { method, path },
});

const call = (env: string, path = '/orders/:param', meta: Record<string, unknown> = {}): GraphNode => ({
  id: `http_out:storefront#src/clients.ts:${env}`,
  type: 'http_out',
  label: `GET ${path}`,
  repo: 'storefront',
  file: 'src/clients.ts',
  line: 12,
  meta: { method: 'GET', path, url: `\${${env}}${path}`, baseUrlEnv: env, ...meta },
});

const backends = (): RepoGraph[] => [
  graph('orders', [route('orders', 'GET', '/orders/:param')]),
  graph('payments', [route('payments', 'GET', '/orders/:param'), route('payments', 'POST', '/payments')]),
];

const files = (values: Record<string, Array<{ value: string; file: string; within?: string }>>, extra: Partial<RepoSettings> = {}): Record<string, RepoSettings> => ({
  storefront: { values, namedOnly: {}, hosts: [], ...extra },
});

const link = (calls: GraphNode[], settings: Record<string, RepoSettings>, cfg = config(), more: RepoGraph[] = []) =>
  linkGraphs([...backends(), graph('storefront', calls), ...more], cfg, { builtAt: FIXED, settings });

const callsOut = (result: ReturnType<typeof link>) => result.project.edges.filter((edge) => edge.type === 'http_calls');
const reasons = (result: ReturnType<typeof link>) => result.project.unresolved.map((row) => row.reason);

describe('a base address from the value its setting is given (P77)', () => {
  it('joins a request to the service a file’s value names, as a guess, and says where the value is', () => {
    const result = link([call('ORDERS_API')], files({ ORDERS_API: [{ value: 'http://orders:3000', file: '.env.example' }] }));
    expect(callsOut(result)).toEqual([
      expect.objectContaining({
        to: 'entry:orders:http:GET:/orders/:param',
        confidence: 'heuristic',
        meta: expect.objectContaining({ via: 'baseUrlValue', targetService: 'orders', baseUrl: 'http://orders:3000', baseUrlFrom: '.env.example' }),
      }),
    ]);
    const node = result.project.nodes.find((each) => each.type === 'http_out');
    expect(node?.meta).toMatchObject({ baseUrl: 'http://orders:3000', baseUrlFrom: '.env.example', targetService: 'orders' });
    expect(reasons(result)).toEqual(['base-url-from-files']);
    expect(result.project.unresolved[0]).toMatchObject({ level: 'info', message: 'ORDERS_API is http://orders:3000 in .env.example, which is taken as orders' });
  });

  it('counts one row for every request a value was taken for', () => {
    const result = link(
      [call('ORDERS_API'), { ...call('ORDERS_API'), id: 'http_out:storefront#src/clients.ts:other', line: 30 }],
      files({ ORDERS_API: [{ value: 'http://orders:3000', file: '.env.example' }] }),
    );
    expect(callsOut(result)).toHaveLength(2);
    expect(result.project.unresolved).toEqual([expect.objectContaining({ reason: 'base-url-from-files', sites: 2 })]);
  });

  // P81: the join is a note, so what was missed goes down by the request it
  // closed and the notes go up by one, against the same request with no value.
  it('lowers what was missed by the request it joined, and counts the join as a note', () => {
    // A setting named after no service, so nothing but the file's value joins it.
    const unread = link([call('UPSTREAM')], {});
    const read = link([call('UPSTREAM')], files({ UPSTREAM: [{ value: 'http://orders:3000', file: '.env.example' }] }));
    expect(unread.report.totals).toMatchObject({ missed: 1, notes: 0, findings: 0 });
    expect(read.report.totals).toMatchObject({ missed: 0, sites: 0, notes: 1, findings: 0 });
    expect(read.report.totals.missed).toBe(unread.report.totals.missed - 1);
    for (const result of [unread, read]) expect(result.report.totals.unresolved).toBe(result.report.totals.missed);
  });

  it('reaches a service by a name its own files give it: a container, a published port', () => {
    const settings = {
      ...files({
        PAYMENTS_BASE: [{ value: 'http://payments-api:4000', file: 'docker-compose.yml', within: 'shop' }],
        LEDGER: [{ value: 'http://localhost:4000', file: '.env.development' }],
      }),
      payments: { values: {}, namedOnly: {}, hosts: [{ host: 'payments-api', file: 'docker-compose.yml' }, { host: 'localhost:4000', file: 'docker-compose.yml' }] },
    };
    const result = link([call('PAYMENTS_BASE', '/payments', { method: 'POST' }), call('LEDGER', '/payments', { method: 'POST' })], settings);
    expect(callsOut(result).map((edge) => [edge.to, edge.meta?.['baseUrlFrom']])).toEqual([
      ['entry:payments:http:POST:/payments', '.env.development'],
      ['entry:payments:http:POST:/payments', 'docker-compose.yml (shop)'],
    ]);
  });

  it('reaches a service at a host configured for it', () => {
    const result = link(
      [call('ORDERS_API')],
      files({ ORDERS_API: [{ value: 'https://orders.example.com/v1', file: 'serverless.yml' }] }),
      parseConfig({
        services: [
          { name: 'storefront', repo: './storefront', type: 'nestjs' },
          { name: 'orders', repo: './orders', type: 'nestjs', hosts: ['orders.example.com'] },
        ],
      }),
    );
    expect(callsOut(result)[0]?.to).toBe('entry:orders:http:GET:/orders/:param');
  });

  it('draws a third party where the value names a host outside the project', () => {
    const result = link([call('SHIPPING_URL', '/rates')], files({ SHIPPING_URL: [{ value: 'https://api.shipping.example.com/v2', file: '.env.example' }] }));
    expect(result.report.httpOut).toMatchObject({ external: 1, unknownEnv: 0 });
    expect(result.project.edges.find((edge) => edge.to === 'external_api:api.shipping.example.com')).toMatchObject({
      type: 'calls',
      confidence: 'heuristic',
      meta: { baseUrl: 'https://api.shipping.example.com/v2', baseUrlFrom: '.env.example' },
    });
    expect(result.project.nodes.find((node) => node.id === 'external_api:api.shipping.example.com')).toMatchObject({ type: 'external_api' });
  });

  it('takes the code’s own fallback where no file says', () => {
    const result = link([call('ORDERS_API', '/orders/:param', { baseUrlDefault: 'http://orders:3000' })], {});
    expect(callsOut(result)[0]?.meta).toMatchObject({ baseUrlFrom: 'src/clients.ts (the code’s own fallback)' });
  });

  it('takes the value a function running the request is deployed with alone, and as proof', () => {
    const fn: GraphNode = {
      id: 'entry:storefront:invoke:checkout',
      type: 'entry',
      kind: 'invoke',
      label: 'checkout',
      repo: 'storefront',
      meta: { [ENVIRONMENT_META]: { ORDERS_API: { written: '"http://orders:3000"', value: 'http://orders:3000' } } },
    };
    const request = call('ORDERS_API');
    const result = linkGraphs(
      [...backends(), graph('storefront', [fn, request], [{ from: fn.id, to: request.id, type: 'calls', confidence: 'static' }])],
      config(),
      { builtAt: FIXED, settings: files({ ORDERS_API: [{ value: 'http://payments:4000', file: '.env.example' }] }) },
    );
    expect(callsOut(result)[0]).toMatchObject({
      to: 'entry:orders:http:GET:/orders/:param',
      confidence: 'static',
      meta: { baseUrlFrom: 'the environment checkout is deployed with' },
    });
  });

  it('says what was found where the values settle nothing', () => {
    const local = link([call('BACKEND_URL')], files({ BACKEND_URL: [{ value: 'http://localhost:9999', file: '.env.example' }] }));
    expect(local.project.unresolved).toEqual([
      expect.objectContaining({
        reason: 'unknown-base-url-env',
        message: 'no service declares BACKEND_URL; its value is http://localhost:9999 in .env.example, and no configured service is reached at that host',
      }),
    ]);
    // A port nobody is known to listen on leaves the name to decide.
    const named = link([call('ORDERS_API')], files({ ORDERS_API: [{ value: 'http://localhost:9999', file: '.env.example' }] }));
    expect(named.project.unresolved[0]?.message).toBe(
      'no service declares ORDERS_API and no configured service is reached at http://localhost:9999, so it is taken as orders, the one service it is named after',
    );
    const split = link(
      [call('ORDERS_API')],
      files({ ORDERS_API: [{ value: 'http://orders:3000', file: '.env.example' }, { value: 'http://payments:4000', file: 'docker-compose.yml' }] }),
    );
    expect(split.project.unresolved[0]?.message).toContain('which name orders and payments, not one service');
    expect(split.project.unresolved[0]?.hint).toContain('settingFiles.environment');
    const hidden = link([call('INVENTORY_URL')], files({}, { namedOnly: { INVENTORY_URL: ['.env'] } }));
    expect(hidden.project.unresolved[0]?.message).toBe('no service declares INVENTORY_URL; it is set in .env, whose values are never read');
  });

  it('takes the one service a setting is named after where nothing gives it a value', () => {
    const result = link([call('ORDERS_SERVICE_URL')], files({}, { namedOnly: { ORDERS_SERVICE_URL: ['.env'] } }));
    expect(callsOut(result)[0]).toMatchObject({ to: 'entry:orders:http:GET:/orders/:param', confidence: 'heuristic' });
    expect(callsOut(result)[0]?.meta).toMatchObject({ baseUrlFrom: 'its name' });
    expect(callsOut(result)[0]?.meta?.['baseUrl']).toBeUndefined();
    expect(result.project.unresolved).toEqual([
      expect.objectContaining({
        reason: 'base-url-from-name',
        level: 'info',
        message: 'no service declares ORDERS_SERVICE_URL and nothing read gives it a value (it is set in .env, whose values are never read), so it is taken as orders, the one service it is named after',
      }),
    ]);
    expect(serviceNamed(['ORDERS_URL'], ['orders', 'orders-admin'])).toBe('orders');
    expect(serviceNamed(['ORDER_URL'], ['orders'])).toBeUndefined();
    expect(serviceNamed(['API_URL'], ['api'])).toBeUndefined();
  });

  it('joins a key a settings factory builds to whoever claims the variable behind it', () => {
    const result = link(
      [call('orders.url', '/orders/:param', { baseUrlVariable: 'ORDERS_URL' })],
      {},
      parseConfig({
        services: [
          { name: 'storefront', repo: './storefront', type: 'nestjs' },
          { name: 'orders', repo: './orders', type: 'nestjs', baseUrlEnv: ['ORDERS_URL'] },
        ],
      }),
    );
    expect(callsOut(result)[0]).toMatchObject({ confidence: 'static', meta: { via: 'baseUrlEnv' } });
  });

  it('reads nothing where the configuration turns it off', () => {
    const result = link(
      [call('ORDERS_SERVICE_URL'), call('ORDERS_API')],
      files({ ORDERS_API: [{ value: 'http://orders:3000', file: '.env.example' }] }),
      config({ settingFiles: { read: false } }),
    );
    expect(callsOut(result)).toEqual([]);
    expect(reasons(result)).toEqual(['unknown-base-url-env', 'unknown-base-url-env']);
  });

  it('joins a browser’s request the same way', () => {
    const request: GraphNode = {
      id: 'ui_api_call:web#src/api.ts:10:5',
      type: 'ui_api_call',
      kind: 'http',
      label: 'request',
      repo: 'web',
      file: 'src/api.ts',
      line: 10,
      meta: { method: 'GET', path: '/orders/:param', baseUrlEnv: 'VITE_API_URL' },
    };
    const result = linkGraphs([...backends(), graph('web', [request])], config(), {
      builtAt: FIXED,
      settings: { web: { values: { VITE_API_URL: [{ value: 'http://localhost:3001', file: '.env.development' }] }, namedOnly: {}, hosts: [] }, orders: { values: {}, namedOnly: {}, hosts: [{ host: 'localhost:3001', file: '.env.example' }] } },
    });
    expect(result.project.edges.find((edge) => edge.type === 'hits')).toMatchObject({
      to: 'entry:orders:http:GET:/orders/:param',
      confidence: 'heuristic',
      meta: { via: 'base-url-value', baseUrlFrom: '.env.development' },
    });
  });
});
