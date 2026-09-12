import { describe, expect, it } from 'vitest';
import { configAlongFlow, configEverywhere } from './config-keys.js';
import { buildTestDb, edge, node } from './__fixtures__/test-db.js';

const key = (id: string, name: string, over = {}) =>
  node(id, { type: 'config_key', label: name, meta: { key: name, source: 'config.get' }, ...over });

/**
 * One flow, two services, and a guard.
 *
 * `entry --guarded_by--> AuthGuard` reaches a class, and the read happens in
 * one of its methods, which nothing in the graph points at. That gap is the
 * reason this collector exists at all.
 */
const flow = {
  nodes: [
    node('entry:gateway:http:POST:/orders', { type: 'entry', kind: 'http', repo: 'gateway' }),
    node('gateway#src/auth.ts:AuthGuard', { type: 'guard', repo: 'gateway' }),
    node('gateway#src/auth.ts:AuthGuard.canActivate', { repo: 'gateway' }),
    node('gateway#src/c.ts:OrdersController.create', { repo: 'gateway' }),
    node('gateway#src/client.ts:OrdersClient.create', { repo: 'gateway' }),
    node('http_out:gateway#src/client.ts:9:5', { type: 'http_out', repo: 'gateway' }),
    node('entry:orders:http:POST:/orders/create', { type: 'entry', kind: 'http' }),
    node('orders#src/s.ts:OrdersService.create'),
    key('config_key:gateway#JWT_SECRET', 'JWT_SECRET', { repo: 'gateway' }),
    key('config_key:gateway#ORDERS_URL', 'ORDERS_URL', { repo: 'gateway' }),
    key('config_key:orders#ORDERS_DB_URL', 'ORDERS_DB_URL'),
    key('config_key:orders#UNRELATED', 'UNRELATED'),
    node('orders#src/elsewhere.ts:Other.run'),
  ],
  edges: [
    edge('entry:gateway:http:POST:/orders', 'gateway#src/auth.ts:AuthGuard', {
      type: 'guarded_by',
    }),
    edge('gateway#src/auth.ts:AuthGuard.canActivate', 'config_key:gateway#JWT_SECRET', {
      type: 'reads_config',
      file: 'src/auth.ts',
      line: 15,
    }),
    edge('entry:gateway:http:POST:/orders', 'gateway#src/c.ts:OrdersController.create', {
      type: 'handles',
    }),
    edge('gateway#src/c.ts:OrdersController.create', 'gateway#src/client.ts:OrdersClient.create'),
    edge('gateway#src/client.ts:OrdersClient.create', 'config_key:gateway#ORDERS_URL', {
      type: 'reads_config',
    }),
    edge('gateway#src/client.ts:OrdersClient.create', 'http_out:gateway#src/client.ts:9:5'),
    edge('http_out:gateway#src/client.ts:9:5', 'entry:orders:http:POST:/orders/create', {
      type: 'http_calls',
    }),
    edge('entry:orders:http:POST:/orders/create', 'orders#src/s.ts:OrdersService.create', {
      type: 'handles',
    }),
    edge('orders#src/s.ts:OrdersService.create', 'config_key:orders#ORDERS_DB_URL', {
      type: 'reads_config',
    }),
    edge('orders#src/elsewhere.ts:Other.run', 'config_key:orders#UNRELATED', {
      type: 'reads_config',
    }),
  ],
};

describe('the settings one flow needs', () => {
  it('collects a key read inside a guard, which is reached as a class', () => {
    const db = buildTestDb(flow);
    const result = configAlongFlow(db, 'entry:gateway:http:POST:/orders');
    db.close();

    expect(result.services['gateway']?.map((row) => row.key)).toEqual(['JWT_SECRET', 'ORDERS_URL']);
    expect(result.services['gateway']?.[0]?.readAt).toEqual([
      { file: 'src/auth.ts', line: 15, symbol: 'gateway#src/auth.ts:AuthGuard.canActivate' },
    ]);
  });

  it('crosses the service boundary the request crosses', () => {
    const db = buildTestDb(flow);
    const result = configAlongFlow(db, 'entry:gateway:http:POST:/orders');
    db.close();

    expect(result.services['orders']?.map((row) => row.key)).toEqual(['ORDERS_DB_URL']);
  });

  it('leaves out a key read somewhere this flow never goes', () => {
    const db = buildTestDb(flow);
    const result = configAlongFlow(db, 'entry:gateway:http:POST:/orders');
    db.close();

    const keys = Object.values(result.services).flatMap((rows) => rows.map((row) => row.key));
    expect(keys).not.toContain('UNRELATED');
  });

  it('says how the value is reached', () => {
    const db = buildTestDb(flow);
    const result = configAlongFlow(db, 'entry:gateway:http:POST:/orders');
    db.close();

    expect(result.services['gateway']?.[0]?.via).toBe('config.get');
  });

  it('counts what the build could not work out along the way', () => {
    const db = buildTestDb({
      nodes: [
        node('entry:orders:http:GET:/a', { type: 'entry', kind: 'http' }),
        node('orders#src/s.ts:S.run'),
      ],
      edges: [edge('entry:orders:http:GET:/a', 'orders#src/s.ts:S.run', { type: 'handles' })],
      unresolved: [
        {
          reason: 'dynamic-config-key',
          file: 'src/s.ts',
          line: 4,
          service: 'orders',
          symbol: 'orders#src/s.ts:S.run',
        },
      ],
    });

    const result = configAlongFlow(db, 'entry:orders:http:GET:/a');
    db.close();
    expect(result.unresolvedAlongFlow).toBe(1);
  });
});

describe('every setting the project reads', () => {
  it('lists each service in order with every key it reads', () => {
    const db = buildTestDb(flow);
    const result = configEverywhere(db);
    db.close();

    expect(Object.keys(result.services)).toEqual(['gateway', 'orders']);
    expect(result.services['orders']?.map((row) => row.key)).toEqual([
      'ORDERS_DB_URL',
      'UNRELATED',
    ]);
  });

  it('counts the keys that were built at run time and could not be recorded', () => {
    const db = buildTestDb({
      nodes: [],
      edges: [],
      unresolved: [
        { reason: 'dynamic-config-key', file: 'src/a.ts', line: 1, service: 'orders' },
        { reason: 'dynamic-config-key', file: 'src/b.ts', line: 2, service: 'orders' },
        { reason: 'di-token-unknown', file: 'src/c.ts', line: 3, service: 'orders' },
      ],
    });

    const result = configEverywhere(db);
    db.close();
    expect(result.unresolvedAlongFlow).toBe(2);
  });
});
