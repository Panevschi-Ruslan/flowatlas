import { cp, rm } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  AdapterRegistry,
  parseConfig,
  parseRepoGraph,
  parseTypeRef,
  type RepoGraph,
} from '@flowatlas/core';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { extractRepo } from '@flowatlas/extractor-nestjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runExtract, summarise } from './extract.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const fixture = (name: string): string => join(ROOT, 'fixtures', name);

const graphs = new Map<string, RepoGraph>();

const load = (name: string): RepoGraph => {
  const graph = graphs.get(name);
  if (graph === undefined) throw new Error(`fixture ${name} was not extracted`);
  return graph;
};

const edgesOf = (graph: RepoGraph, type: string) => graph.edges.filter((edge) => edge.type === type);
const nodesOf = (graph: RepoGraph, type: string) => graph.nodes.filter((node) => node.type === type);
const reasons = (graph: RepoGraph): string[] => graph.unresolved.map((row) => row.reason).sort();

beforeAll(async () => {
  for (const name of [
  'nest-basic',
  'nest-guards',
  'nest-di-tokens',
  'nest-entries',
  'nest-types',
  'nest-typeorm',
  'nest-prisma',
  'nest-pg',
  'nest-leaves',
  'nest-unknown-orm',
  'nest-kafka',
  'nest-rabbitmq',
  'nest-bullmq',
  'nest-redis-pubsub',
  'nest-broker-markers',
  'nest-client-wrapper',
  'nest-telegraf',
  'angular-basic',
]) {
    const { graph } = await runExtract(fixture(name), { out: '.flowatlas' });
    graphs.set(name, graph);
  }
}, 120_000);

describe('every fixture', () => {
  it.each([
  'nest-basic',
  'nest-guards',
  'nest-di-tokens',
  'nest-entries',
  'nest-types',
  'nest-typeorm',
  'nest-prisma',
  'nest-pg',
  'nest-leaves',
  'nest-unknown-orm',
  'nest-kafka',
  'nest-rabbitmq',
  'nest-bullmq',
  'nest-redis-pubsub',
  'nest-broker-markers',
  'nest-client-wrapper',
  'nest-telegraf',
])(
    '%s produces a graph that validates',
    (name) => {
      expect(() => parseRepoGraph(load(name))).not.toThrow();
    },
  );

  it.each([
  'nest-basic',
  'nest-guards',
  'nest-di-tokens',
  'nest-entries',
  'nest-types',
  'nest-typeorm',
  'nest-prisma',
  'nest-pg',
  'nest-leaves',
  'nest-unknown-orm',
  'nest-kafka',
  'nest-rabbitmq',
  'nest-bullmq',
  'nest-redis-pubsub',
  'nest-broker-markers',
  'nest-client-wrapper',
  'nest-telegraf',
])(
    '%s keeps every call inside the repository',
    (name) => {
      const graph = load(name);
      const ids = new Set(graph.nodes.map((node) => node.id));
      for (const edge of edgesOf(graph, 'calls')) {
        expect(ids.has(edge.to)).toBe(true);
        expect(edge.to).not.toContain('node_modules');
      }
    },
  );

  it.each([
  'nest-basic',
  'nest-guards',
  'nest-di-tokens',
  'nest-entries',
  'nest-types',
  'nest-typeorm',
  'nest-prisma',
  'nest-pg',
  'nest-leaves',
  'nest-unknown-orm',
  'nest-kafka',
  'nest-rabbitmq',
  'nest-bullmq',
  'nest-redis-pubsub',
  'nest-broker-markers',
  'nest-client-wrapper',
  'nest-telegraf',
])(
    '%s labels every edge with how far it can be trusted',
    (name) => {
      const graph = load(name);
      for (const edge of graph.edges) {
        expect(['static', 'marker', 'heuristic', 'runtime']).toContain(edge.confidence);
      }
      // What the type system settles is never a guess. A handler named by an
      // annotation is the exception: it was told, not proven.
      for (const edge of graph.edges) {
        if (['injects', 'imports', 'guarded_by'].includes(edge.type)) {
          expect(edge.confidence).toBe('static');
        }
        if (edge.type === 'handles' && edge.from.startsWith('entry:')) {
          expect(edge.confidence).toBe('static');
        }
      }
    },
  );
});

describe('nest-basic', () => {
  it('finds every route, with the global prefix applied', () => {
    const entries = nodesOf(load('nest-basic'), 'entry');
    expect(entries.map((node) => node.id).sort()).toEqual([
      'entry:nest-basic:http:DELETE:/api/orders/:param',
      'entry:nest-basic:http:GET:/api/orders',
      'entry:nest-basic:http:GET:/api/orders/:param',
      'entry:nest-basic:http:GET:/api/users',
      'entry:nest-basic:http:POST:/api/orders',
    ]);
  });

  it('points each route at the method that answers it', () => {
    const graph = load('nest-basic');
    const handles = edgesOf(graph, 'handles');
    expect(handles).toHaveLength(5);
    const target = handles.find((edge) => edge.from === 'entry:nest-basic:http:GET:/api/orders');
    expect(target?.to).toBe('nest-basic#src/orders/orders.controller.ts:OrdersController.findAll');
  });

  it('follows an injected service into its method', () => {
    const graph = load('nest-basic');
    const call = edgesOf(graph, 'calls').find(
      (edge) =>
        edge.from === 'nest-basic#src/orders/orders.service.ts:OrdersService.create' &&
        edge.to === 'nest-basic#src/users/users.service.ts:UsersService.findOne',
    );
    expect(call).toBeDefined();
  });

  it('follows a call to another method of the same class', () => {
    const graph = load('nest-basic');
    const call = edgesOf(graph, 'calls').find((edge) =>
      edge.to.endsWith('OrdersService.validate'),
    );
    expect(call).toBeDefined();
  });

  it('records an injection that came from a package, without expanding it', () => {
    const graph = load('nest-basic');
    const external = graph.nodes.find((node) => node.id.includes('node_modules/@nestjs/common'));
    expect(external?.kind).toBe('external');
    expect(external?.meta?.['package']).toBe('@nestjs/common');
    expect(edgesOf(graph, 'injects').some((edge) => edge.to === external?.id)).toBe(true);
  });

  it('counts calls into a package instead of reporting each one', () => {
    const stats = load('nest-basic').nodes.find((node) => node.type === 'repo')?.meta?.['stats'] as {
      skippedExternalCalls: Record<string, number>;
    };
    expect(Object.keys(stats.skippedExternalCalls).length).toBeGreaterThan(0);
  });

  it('says why each thing it could not follow was left out', () => {
    expect(reasons(load('nest-basic'))).toEqual([
      'call-dynamic-receiver',
      'di-type-unresolved',
      'route-path-dynamic',
    ]);
  });

  it('emits no route for a path it cannot read', () => {
    const graph = load('nest-basic');
    expect(graph.nodes.some((node) => node.id.includes('legacy'))).toBe(false);
  });
});

describe('nest-guards', () => {
  const chain = () => {
    const graph = load('nest-guards');
    return edgesOf(graph, 'guarded_by')
      .filter((edge) => edge.from === 'entry:nest-guards:http:GET:/orders')
      .sort((a, b) => Number(a.meta?.['order']) - Number(b.meta?.['order']));
  };

  it('applies the layers in the order the framework runs them', () => {
    expect(chain().map((edge) => edge.meta?.['layer'])).toEqual([
      'middleware',
      'guard',
      'guard',
      'guard',
      'guard',
      'interceptor',
      'interceptor',
      'pipe',
    ]);
  });

  it('runs the broader scope first within a layer', () => {
    const guards = chain().filter((edge) => edge.meta?.['layer'] === 'guard');
    expect(guards.map((edge) => edge.meta?.['scope'])).toEqual(['global', 'class', 'class', 'method']);
  });

  it('numbers the whole chain once, without gaps', () => {
    expect(chain().map((edge) => edge.meta?.['order'])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('gives a wrapper built by a factory its own node, keyed by its arguments', () => {
    const graph = load('nest-guards');
    const node = graph.nodes.find((item) => item.label.startsWith('AuthGuard('));
    expect(node?.type).toBe('guard');
    expect(node?.meta?.['factoryArgs']).toEqual(['jwt']);
  });

  it('records both applications when one wrapper is attached twice', () => {
    const pipe = chain().find((edge) => edge.meta?.['layer'] === 'pipe');
    expect(pipe?.meta?.['applications']).toEqual([
      { order: 7, scope: 'global', source: 'bootstrap' },
      { order: 8, scope: 'method', source: 'UsePipes' },
    ]);
  });

  it('applies middleware only to the routes it was bound to', () => {
    const graph = load('nest-guards');
    const admin = edgesOf(graph, 'guarded_by').filter(
      (edge) => edge.from === 'entry:nest-guards:http:GET:/admin/stats' && edge.meta?.['layer'] === 'middleware',
    );
    expect(admin).toHaveLength(1);
    expect(admin[0]?.to).toContain('requestIdMiddleware');
  });

  it('gives a function middleware a node of its own', () => {
    const node = load('nest-guards').nodes.find((item) => item.label === 'requestIdMiddleware');
    expect(node?.type).toBe('middleware');
    expect(node?.kind).toBe('function');
  });

  it('leaves nothing unresolved', () => {
    expect(load('nest-guards').unresolved).toEqual([]);
  });
});

describe('nest-di-tokens', () => {
  it('follows a token that names a class', () => {
    const graph = load('nest-di-tokens');
    const edge = edgesOf(graph, 'injects').find((item) => item.to.endsWith('MemoryCache'));
    expect(edge?.confidence).toBe('static');
  });

  it('makes a node for a token backed by a value or a factory', () => {
    const graph = load('nest-di-tokens');
    const kinds = graph.nodes
      .filter((node) => node.meta?.['token'] !== undefined)
      .map((node) => node.kind)
      .sort();
    expect(kinds).toContain('value');
    expect(kinds).toContain('factory');
  });

  it('refuses to choose when one token names two classes', () => {
    expect(reasons(load('nest-di-tokens'))).toContain('di-token-ambiguous');
  });

  it('says so when nothing provides a token', () => {
    expect(reasons(load('nest-di-tokens'))).toContain('di-token-unknown');
  });

  it('survives a cycle written with forwardRef, and keeps both edges', () => {
    const graph = load('nest-di-tokens');
    const injects = edgesOf(graph, 'injects');
    const forward = injects.some(
      (edge) => edge.from.endsWith('OrdersService') && edge.to.endsWith('PaymentsService'),
    );
    const back = injects.some(
      (edge) => edge.from.endsWith('PaymentsService') && edge.to.endsWith('OrdersService'),
    );
    expect([forward, back]).toEqual([true, true]);
  });
});

describe('nest-entries', () => {
  it('finds message and event handlers', () => {
    const graph = load('nest-entries');
    const byKind = nodesOf(graph, 'entry').filter((node) => node.kind === 'event' || node.kind === 'rpc');
    expect(byKind.map((node) => node.id).sort()).toEqual([
      'entry:nest-entries:event:order.created',
      'entry:nest-entries:rpc:{"cmd":"sum"}',
    ]);
  });

  it('keeps the pattern it matched on', () => {
    const rpc = load('nest-entries').nodes.find(
      (node) => node.type === 'entry' && node.kind === 'rpc',
    );
    expect(rpc?.meta?.['pattern']).toEqual({ cmd: 'sum' });
  });

  it('finds every scheduled job', () => {
    const cron = nodesOf(load('nest-entries'), 'entry').filter((node) => node.kind === 'cron');
    expect(cron).toHaveLength(4);
    expect(cron.map((node) => node.meta?.['trigger']).sort()).toEqual([
      'Cron',
      'Cron',
      'Interval',
      'Timeout',
    ]);
  });

  it('resolves a schedule written as a framework constant', () => {
    const hourly = load('nest-entries').nodes.find((node) => node.id.endsWith('everyHour'));
    expect(typeof hourly?.meta?.['expression']).toBe('string');
    expect(hourly?.meta?.['expression']).not.toBe('');
  });

  it('makes one route per path when a handler declares several', () => {
    const graph = load('nest-entries');
    expect(graph.nodes.some((node) => node.id === 'entry:nest-entries:http:GET:/catalog/a')).toBe(true);
    expect(graph.nodes.some((node) => node.id === 'entry:nest-entries:http:GET:/catalog/b')).toBe(true);
  });

  it('records the version of a versioned route', () => {
    const versioned = load('nest-entries').nodes.find((node) => node.meta?.['version'] !== undefined);
    expect(versioned?.meta?.['version']).toBe('2');
  });
});

describe('adapter selection', () => {
  it('finds nothing without adapters', async () => {
    const graph = await extractRepo({ rootDir: fixture('nest-entries'), repo: 'nest-entries' });
    expect(graph.nodes.filter((node) => node.type === 'entry')).toEqual([]);
  });

  it('honours a forced list, leaving the other kinds of entry out', async () => {
    const graph = await extractRepo({
      rootDir: fixture('nest-entries'),
      repo: 'nest-entries',
      registry: registerEntryAdapters(new AdapterRegistry()),
      config: parseConfig({ adapters: { auto: true, force: { entry: ['nestjs-http'] } } }),
    });
    const kinds = new Set(
      graph.nodes.filter((node) => node.type === 'entry').map((node) => node.kind),
    );
    expect([...kinds]).toEqual(['http']);
  });
});

describe('a repository without a schedule dependency', () => {
  const temporary = fixture('.tmp-no-schedule');

  beforeAll(async () => {
    await rm(temporary, { recursive: true, force: true });
    await cp(fixture('nest-entries'), temporary, { recursive: true });
    const manifest = join(temporary, 'package.json');
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
      dependencies: Record<string, string>;
    };
    delete pkg.dependencies['@nestjs/schedule'];
    writeFileSync(manifest, JSON.stringify(pkg, null, 2));
  }, 60_000);

  afterAll(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  it('has no scheduled entries, because the adapter does not apply', async () => {
    const graph = await extractRepo({
      rootDir: temporary,
      repo: 'no-schedule',
      registry: registerEntryAdapters(new AdapterRegistry()),
    });
    const kinds = new Set(
      graph.nodes.filter((node) => node.type === 'entry').map((node) => node.kind),
    );
    expect(kinds.has('cron')).toBe(false);
    expect(kinds.has('http')).toBe(true);
  }, 60_000);
});

describe('a repository whose entry file is missing', () => {
  it('still returns a graph, and says the file was not found', async () => {
    const graph = await extractRepo({
      rootDir: fixture('nest-basic'),
      repo: 'nest-basic',
      registry: registerEntryAdapters(new AdapterRegistry()),
      bootstrap: 'src/does-not-exist.ts',
    });
    expect(graph.unresolved.some((row) => row.reason === 'bootstrap-not-found')).toBe(true);
    expect(graph.nodes.length).toBeGreaterThan(0);
  }, 60_000);
});

describe('the summary', () => {
  it('says how much was found and how much was left over', () => {
    const lines = summarise(load('nest-basic'), '/tmp/graph.json').join('\n');
    expect(lines).toContain('repo nest-basic');
    expect(lines).toContain('entries: http 5');
    expect(lines).toMatch(/unresolved: \d+/);
  });
});

describe('nest-types', () => {
  const types = () => load('nest-types').types;

  it('records what a data-transfer object looks like on the wire', () => {
    const dto = types()['type:nest-types#CreateOrderDto'];
    const byName = Object.fromEntries((dto?.fields ?? []).map((field) => [field.name, field]));
    expect(byName['customerId']?.meta).toMatchObject({ expose: true, exposeAs: 'customer_id' });
    expect(byName['items']?.type).toBe('type:nest-types#OrderItemDto[]');
    expect(byName['items']?.meta?.['typeFn']).toBe('type:nest-types#OrderItemDto');
    expect(byName['note']?.optional).toBe(true);
    expect(byName['secret']?.meta).toMatchObject({ exclude: true });
  });

  it('gives two types of the same shape the same hash', () => {
    expect(types()['type:nest-types#Shape1']?.structuralHash).toBe(
      types()['type:nest-types#Shape2']?.structuralHash,
    );
  });

  it('gives two types of different shapes different hashes', () => {
    expect(types()['type:nest-types#Shape1']?.structuralHash).not.toBe(
      types()['type:nest-types#Order']?.structuralHash,
    );
  });

  it('registers a type that contains itself exactly once', () => {
    const ids = Object.keys(types()).filter((id) => id.endsWith('#Category'));
    expect(ids).toEqual(['type:nest-types#Category']);
  });

  it('flattens what a type inherits and remembers where it came from', () => {
    const order = types()['type:nest-types#Order'];
    const names = (order?.fields ?? []).map((field) => field.name);
    expect(names).toContain('id');
    expect(order?.meta?.['extends']).toEqual(['type:nest-types#BaseEntity']);
  });

  it('points a route at the shapes that reach it and come back', () => {
    const graph = load('nest-types');
    const edge = edgesOf(graph, 'handles').find((item) => item.from.includes('POST:/orders'));
    expect(edge?.params).toEqual(['type:nest-types#CreateOrderDto']);
    expect(edge?.meta?.['body']).toBe('type:nest-types#CreateOrderDto');
    expect(edge?.returns).toBe('type:nest-types#Order');
  });

  it('unwraps a promise before recording what comes back', () => {
    const graph = load('nest-types');
    const listing = edgesOf(graph, 'handles').find((item) => item.from === 'entry:nest-types:http:GET:/orders');
    expect(listing?.returns).toBe('type:nest-types#Paginated<type:nest-types#Order>');
  });

  it('registers both the template of a generic and the way it was used', () => {
    expect(types()['type:nest-types#Paginated']?.kind).toBe('generic');
    expect(types()['type:nest-types#Paginated<type:nest-types#Order>']?.fields).toBeDefined();
  });

  it('reads a shared package in full, under its own name', () => {
    const shared = types()['type:@fixture/contracts#SharedOrderEvent'];
    expect(shared?.kind).toBe('object');
    expect((shared?.fields ?? []).length).toBeGreaterThan(0);
  });

  it('records a type from a dependency without reading it', () => {
    const external = Object.entries(types()).find(([, entry]) => entry.kind === 'external');
    expect(external?.[1].fields).toBeUndefined();
  });

  it('says which types it could not resolve, and which it stopped expanding', () => {
    const graph = load('nest-types');
    const byReason = new Set(graph.unresolved.map((row) => row.reason));
    expect(byReason.has('type-unresolved')).toBe(true);
    expect(byReason.has('type-depth-exceeded')).toBe(true);
    expect(byReason.has('type-generic-uninstantiated')).toBe(true);
  });

  it('marks the rows that are only informational', () => {
    const graph = load('nest-types');
    const info = graph.unresolved.filter((row) => row.reason === 'type-depth-exceeded');
    expect(info[0]?.level).toBe('info');
  });

  it('lists an informational reason once, counting the places it stands for', () => {
    const graph = load('nest-client-wrapper');
    const rows = graph.unresolved.filter((row) => row.reason === 'type-generic-uninstantiated');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sites).toBe(5);
    expect(rows[0]?.file).toBe('src/api/api-client.ts');
  });

  it('gives every entry a hash', () => {
    for (const entry of Object.values(types())) {
      expect(entry.structuralHash).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});

describe('every type reference in every fixture', () => {
  it.each([
  'nest-basic',
  'nest-guards',
  'nest-di-tokens',
  'nest-entries',
  'nest-types',
  'nest-typeorm',
  'nest-prisma',
  'nest-pg',
  'nest-leaves',
  'nest-unknown-orm',
  'nest-kafka',
  'nest-rabbitmq',
  'nest-bullmq',
  'nest-redis-pubsub',
  'nest-broker-markers',
  'nest-client-wrapper',
  'nest-telegraf',
])(
    '%s can be read back',
    (name) => {
      const graph = load(name);
      const refs = new Set<string>();
      for (const edge of graph.edges) {
        for (const param of edge.params ?? []) refs.add(param);
        if (edge.returns !== undefined) refs.add(edge.returns);
      }
      for (const entry of Object.values(graph.types)) {
        for (const field of entry.fields ?? []) refs.add(field.type);
        for (const member of entry.members ?? []) refs.add(member);
      }
      for (const ref of refs) expect(() => parseTypeRef(ref)).not.toThrow();
    },
  );
});

describe('extraction with types turned off', () => {
  it('leaves the registry empty and the edges bare', async () => {
    const graph = await extractRepo({
      rootDir: fixture('nest-types'),
      repo: 'nest-types',
      registry: registerEntryAdapters(new AdapterRegistry()),
      noTypes: true,
    });
    expect(graph.types).toEqual({});
    expect(graph.edges.every((edge) => edge.params === undefined && edge.returns === undefined)).toBe(
      true,
    );
    expect(graph.nodes.length).toBeGreaterThan(0);
  }, 60_000);
});

const leafOf = (name: string, type: string) =>
  load(name).nodes.filter((node) => node.type === type);

describe('data access', () => {
  it('is certain when the package that declares the receiver is described', () => {
    const queries = leafOf('nest-typeorm', 'db_query');
    expect(queries).toHaveLength(4);
    expect(queries.map((node) => node.meta?.['op']).sort()).toEqual([
      'delete',
      'read',
      'read',
      'write',
    ]);
    for (const query of queries) expect(query.meta?.['package']).toBe('typeorm');
  });

  it('believes the package over the name of the variable', () => {
    // The receiver is called `orderCache`, and it is still a repository.
    const cached = leafOf('nest-typeorm', 'db_query').find((node) =>
      String(node.meta?.['receiver']).includes('orderCache'),
    );
    expect(cached?.meta?.['table']).toBe('Order');
    expect(cached?.meta?.['source']).toBe('type-arg');
  });

  it('takes the table from the property when the types do not carry it', () => {
    const tables = leafOf('nest-prisma', 'table').map((node) => node.label).sort();
    expect(tables).toEqual(['order', 'user']);
    for (const query of leafOf('nest-prisma', 'db_query')) {
      expect(query.meta?.['source']).toBe('receiver-prop');
    }
  });

  it('follows a client wrapped in a class of the project own', () => {
    for (const query of leafOf('nest-prisma', 'db_query')) {
      expect(query.meta?.['package']).toBe('@prisma/client');
    }
  });

  it('reads the tables out of a query when the types carry nothing', () => {
    const tables = leafOf('nest-pg', 'table').map((node) => node.label).sort();
    expect(tables).toEqual(['customers', 'invoices', 'orders']);
  });

  it('does not report a name that exists only inside one query', () => {
    expect(leafOf('nest-pg', 'table').map((node) => node.label)).not.toContain('recent');
  });

  it('still records a query it could not read, and says so', () => {
    const graph = load('nest-pg');
    const unreadable = graph.nodes.find(
      (node) => node.type === 'db_query' && node.meta?.['table'] === null,
    );
    expect(unreadable).toBeDefined();
    expect(graph.unresolved.map((row) => row.reason)).toContain('sql-parse-failed');
  });

  it('keeps an unfamiliar data layer in the graph, losing only the operation', () => {
    const graph = load('nest-unknown-orm');
    const fromLibrary = graph.nodes.filter(
      (node) => node.type === 'db_query' && node.meta?.['package'] === 'fake-orm',
    );
    expect(fromLibrary).toHaveLength(2);
    for (const node of fromLibrary) {
      expect(node.meta?.['table']).toBe('Order');
      expect(node.meta?.['op']).toBeNull();
    }
    expect(graph.unresolved.filter((row) => row.reason === 'unknown-db-package')).toHaveLength(2);
  });

  it('says when a name was all it had to go on', () => {
    const graph = load('nest-unknown-orm');
    const guessed = graph.nodes.find(
      (node) => node.type === 'db_query' && node.meta?.['table'] === null,
    );
    expect(guessed?.meta?.['source']).toBe('none');
    expect(graph.unresolved.map((row) => row.reason)).toContain('db-receiver-name-only');
  });

  it('marks a guess as a guess and a proof as proof', () => {
    for (const edge of load('nest-typeorm').edges.filter((item) => item.type === 'queries')) {
      expect(edge.confidence).toBe('static');
    }
    for (const edge of load('nest-unknown-orm').edges.filter((item) => item.type === 'queries')) {
      expect(edge.confidence).toBe('heuristic');
    }
  });
});

describe('cache, outgoing calls and configuration', () => {
  it('keeps the shape of a cache key when part of it is fixed', () => {
    const patterns = leafOf('nest-leaves', 'cache_op').map((node) => node.meta?.['keyPattern']);
    expect(patterns).toContain('orders:index');
    expect(patterns).toContain('orders:*');
    expect(patterns).toContain(null);
  });

  it('says when a cache key is built entirely at run time', () => {
    expect(load('nest-leaves').unresolved.map((row) => row.reason)).toContain('dynamic-cache-key');
  });

  it('records the configuration key an address is rooted at', () => {
    const call = leafOf('nest-leaves', 'http_out').find(
      (node) => node.meta?.['baseUrlEnv'] === 'ORDERS_URL' && node.meta?.['method'] === 'GET',
    );
    expect(call?.meta?.['path']).toBe('/orders/:param');
    expect(call?.meta?.['responseType']).toBe('type:nest-leaves#OrderDto');
  });

  it('records what is sent as well as what comes back', () => {
    const posted = leafOf('nest-leaves', 'http_out').find(
      (node) => node.meta?.['method'] === 'POST' && node.meta?.['baseUrlEnv'] === 'ORDERS_URL',
    );
    expect(posted?.meta?.['bodyType']).toBe('type:nest-leaves#OrderDto');
  });

  it('gives a third party a node of its own, shared across repositories', () => {
    const hosts = leafOf('nest-leaves', 'external_api').map((node) => node.label).sort();
    expect(hosts).toContain('api.stripe.com');
    expect(load('nest-leaves').nodes.find((node) => node.type === 'external_api')?.id).toMatch(
      /^external_api:/,
    );
  });

  it('says when an address is built at run time', () => {
    expect(load('nest-leaves').unresolved.map((row) => row.reason)).toContain('dynamic-http-url');
  });

  it('reads the method out of the options of a plain request', () => {
    const head = leafOf('nest-leaves', 'http_out').find((node) => node.meta?.['method'] === 'HEAD');
    expect(head?.meta?.['host']).toBe('example.test');
  });

  it('records every way a configuration value is reached', () => {
    const keys = leafOf('nest-leaves', 'config_key');
    const byName = Object.fromEntries(keys.map((node) => [node.label, node.meta]));
    expect(byName['FEATURE_X']?.['source']).toBe('config.get');
    expect(byName['NODE_ENV']?.['source']).toBe('process.env');
    expect(byName['TIMEOUT_MS']?.['defaultValue']).toBe('5000');
  });

  it('joins each reading method to the key it reads', () => {
    const edges = load('nest-leaves').edges.filter((edge) => edge.type === 'reads_config');
    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) expect(edge.to).toMatch(/^config_key:/);
  });

  it('says when a configuration key is itself computed', () => {
    expect(load('nest-leaves').unresolved.map((row) => row.reason)).toContain('dynamic-config-key');
  });

  it('reports how many leaves it found', () => {
    const lines = summarise(load('nest-leaves'), '/tmp/graph.json').join('\n');
    expect(lines).toMatch(/leaves: db=\d+ cache=\d+ http=\d+ config=\d+/);
  });
});

describe('channels', () => {
  it.each(['nest-kafka', 'nest-rabbitmq', 'nest-bullmq', 'nest-redis-pubsub', 'nest-broker-markers'])(
    '%s gives every channel an id no repository could claim',
    (name) => {
      for (const node of leafOf(name, 'channel')) {
        expect(node.id).toMatch(/^channel:/);
        expect(node.id).not.toContain('#');
      }
    },
  );

  it('reads a name written four different ways', () => {
    const ways = new Set(
      leafOf('nest-kafka', 'producer').map((node) => node.meta?.['channelVia']),
    );
    expect(ways).toContain('literal');
    expect(ways).toContain('enum');
    expect(ways).toContain('shared-package');
    expect(ways).toContain('const');
  });

  it('follows a name into a package shared between services', () => {
    const shared = leafOf('nest-kafka', 'producer').find(
      (node) => node.meta?.['channelVia'] === 'shared-package',
    );
    expect(shared).toBeDefined();
    expect(leafOf('nest-kafka', 'channel').map((node) => node.label)).toContain('order.shipped');
  });

  it('will not guess a name read from settings, and says which annotation would fix it', () => {
    const graph = load('nest-kafka');
    const row = graph.unresolved.find((item) => item.reason === 'channel-from-config');
    expect(row).toBeDefined();
    expect(row?.hint).toMatch(/annotate/i);
  });

  it('produces no channel for a name it could not read', () => {
    const graph = load('nest-kafka');
    const dynamic = graph.nodes.filter(
      (node) => node.type === 'producer' && node.meta?.['channelVia'] === 'unresolved',
    );
    expect(dynamic.length).toBeGreaterThan(0);
    for (const producer of dynamic) {
      expect(graph.edges.some((edge) => edge.type === 'emits' && edge.from === producer.id)).toBe(
        false,
      );
    }
  });

  it('points a channel at what receives from it, not the other way round', () => {
    for (const edge of load('nest-kafka').edges.filter((item) => item.type === 'consumes')) {
      expect(edge.from).toMatch(/^channel:/);
      expect(edge.to).toMatch(/^consumer:/);
    }
  });

  it('joins each handler to the entry point the framework already found', () => {
    const graph = load('nest-kafka');
    const entries = new Set(graph.nodes.filter((node) => node.type === 'entry').map((n) => n.id));
    const consumers = graph.nodes.filter(
      (node) => node.type === 'consumer' && node.meta?.['entryId'] !== null,
    );
    expect(consumers.length).toBeGreaterThan(0);
    for (const consumer of consumers) {
      expect(entries.has(String(consumer.meta?.['entryId']))).toBe(true);
    }
  });

  it('names the queue a job goes to, and the job itself separately', () => {
    const graph = load('nest-bullmq');
    expect(leafOf('nest-bullmq', 'channel').map((node) => node.label).sort()).toEqual([
      'digest',
      'mail',
      'reports',
    ]);
    const producer = graph.nodes.find(
      (node) => node.type === 'producer' && node.meta?.['jobName'] === 'send-email',
    );
    expect(producer).toBeDefined();
    for (const channel of leafOf('nest-bullmq', 'channel')) {
      expect(channel.meta?.['channelKind']).toBe('queue');
    }
  });

  it('reads a handler on a class nothing else in the repository reaches', () => {
    // The only way into `ReportsProcessor.process` is the queue it is
    // subscribed to: no module lists the class, no constructor asks for it and
    // nothing calls it, so no earlier pass puts it in the graph. Receiving used
    // to require that it already be there, which made a worker deployed on its
    // own read as a channel nobody listens to (R60).
    const consumer = leafOf('nest-bullmq', 'consumer').find(
      (node) => node.label === 'ReportsProcessor.process',
    );
    expect(consumer).toBeDefined();
    const graph = load('nest-bullmq');
    const consumes = graph.edges.filter(
      (edge) => edge.type === 'consumes' && edge.to === consumer?.id,
    );
    expect(consumes.map((edge) => edge.from)).toEqual(['channel:reports']);
    // The method the `handles` edge points at is created by the consumer
    // emitter rather than found there, which is what makes dropping the gate
    // safe rather than merely permissive.
    expect(graph.nodes.some((node) => node.label === 'ReportsProcessor.process' && node.type === 'method')).toBe(true);
  });

  it('addresses a channel written in two parts by the part that identifies it', () => {
    const graph = load('nest-rabbitmq');
    const published = graph.nodes.find(
      (node) => node.type === 'producer' && node.meta?.['exchange'] !== undefined,
    );
    expect(published?.meta?.['exchange']).toBeTypeOf('string');
    expect(leafOf('nest-rabbitmq', 'channel').map((node) => node.label)).toContain('order.created');
  });

  it('follows a listener that only delegates to the method it delegates to', () => {
    const consumers = leafOf('nest-redis-pubsub', 'consumer').map((node) => node.label);
    expect(consumers).toContain('CacheSubscriberService.handleInvalidation');
  });

  it('stops at the registering method when a listener does more than delegate', () => {
    const graph = load('nest-redis-pubsub');
    expect(leafOf('nest-redis-pubsub', 'consumer').map((node) => node.label)).toContain(
      'CacheSubscriberService.onModuleInit',
    );
    expect(graph.unresolved.map((row) => row.reason)).toContain('consumer-handler-unresolved');
  });
});

describe('channels named by annotation', () => {
  const markerEdges = (type: string) =>
    load('nest-broker-markers').edges.filter(
      (edge) => edge.type === type && edge.confidence === 'marker',
    );

  it('marks an annotated channel as told rather than proven', () => {
    expect(markerEdges('emits').length).toBeGreaterThan(0);
    expect(markerEdges('consumes').length).toBeGreaterThan(0);
  });

  it('draws nothing extra where the code already says the same thing', () => {
    const graph = load('nest-broker-markers');
    const created = graph.edges.filter(
      (edge) => edge.type === 'emits' && edge.to === 'channel:order.created',
    );
    expect(created.every((edge) => edge.confidence === 'static')).toBe(true);
  });

  it('keeps an annotation that names a channel the code does not', () => {
    const labels = leafOf('nest-broker-markers', 'channel').map((node) => node.label);
    expect(labels).toContain('order.exported');
    expect(labels).toContain('order.archived');
  });

  it('finds a bus described in configuration, with no library to detect', () => {
    const graph = load('nest-broker-markers');
    const fromBus = graph.nodes.filter(
      (node) => node.type === 'producer' && node.meta?.['channelVia'] !== 'marker',
    );
    expect(fromBus.length).toBeGreaterThan(0);
    for (const producer of fromBus) expect(producer.meta?.['adapter']).toBe('event-bus');
  });

  it('reports how many channels, publishers and handlers it found', () => {
    const lines = summarise(load('nest-kafka'), '/tmp/graph.json').join('\n');
    expect(lines).toMatch(/brokers: channels=\d+ producers=\d+ consumers=\d+ markers=\d+/);
  });
});

describe('angular-basic', () => {
  const graph = (): RepoGraph => load('angular-basic');

  it('reads a repository the frontend adapter recognises, without being told to', () => {
    expect(nodesOf(graph(), 'ui_component')).toHaveLength(6);
    expect(nodesOf(graph(), 'ui_api_call')).toHaveLength(5);
  });

  it('tells a standalone component from one a module declares', () => {
    const byKind = Object.fromEntries(
      nodesOf(graph(), 'ui_component').map((node) => [node.label, node.kind]),
    );
    expect(byKind).toEqual({
      CheckoutComponent: 'standalone',
      OrdersListComponent: 'declared',
      LegacyPanelComponent: 'declared',
      SettingsComponent: 'standalone',
      ReportsComponent: 'standalone',
      ProfileComponent: 'standalone',
    });
    const declared = nodesOf(graph(), 'ui_component').find(
      (node) => node.label === 'OrdersListComponent',
    );
    expect(declared?.meta).toMatchObject({ module: 'OrdersModule', standalone: false });
  });

  it('draws the module graph', () => {
    expect(
      nodesOf(graph(), 'module')
        .map((node) => node.label)
        .sort(),
    ).toEqual(['OrdersModule', 'SharedModule']);
    expect(
      edgesOf(graph(), 'imports').some(
        (edge) => edge.from.endsWith('OrdersModule') && edge.to.endsWith('SharedModule'),
      ),
    ).toBe(true);
  });

  it('gives every trigger in a template a node of its own', () => {
    const kinds = nodesOf(graph(), 'ui_action')
      .map((node) => node.kind)
      .sort();
    expect(kinds).toEqual([
      'change',
      'click',
      'click',
      'click',
      'click',
      'click',
      'input',
      'keyup',
      'lifecycle',
      'route',
      'route',
      'route',
      'route',
      'route',
      'submit',
    ]);
  });

  it('points a trigger at the method that answers it, wherever that method lives', () => {
    const handled = edgesOf(graph(), 'handles').filter((edge) => edge.from.startsWith('ui_action:'));
    // Fifteen triggers, less the two that name nothing and the five links that
    // open a screen rather than calling a method.
    expect(handled).toHaveLength(8);
    expect(handled.map((edge) => edge.to)).toContain(
      'angular-basic#src/app/orders-api.service.ts:OrdersApiService.refresh',
    );
  });

  it('opens the screen a link navigates to, named or loaded', () => {
    // `/settings`, `/reports` and `/profile` are lazy; `/orders/:id` is not.
    // Which spelling the route used is not visible from here, which is the
    // whole point: the edge and its confidence are the same either way (R13).
    const opened = edgesOf(graph(), 'triggers');
    expect(opened.map((edge) => edge.to).sort()).toEqual([
      'angular-basic#src/app/orders-list.component.ts:OrdersListComponent',
      'angular-basic#src/app/profile.component.ts:ProfileComponent',
      'angular-basic#src/app/reports.component.ts:ReportsComponent',
      'angular-basic#src/app/settings.component.ts:SettingsComponent',
    ]);
    expect(opened.every((edge) => edge.confidence === 'static')).toBe(true);
  });

  it('says the loader was unread rather than that the route is missing', () => {
    const rows = graph().unresolved;
    // `/archive` is configured; its specifier is a value, so the screen is not.
    expect(rows.find((row) => row.reason === 'route-loader-unread')).toMatchObject({
      file: 'src/app/app.routes.ts',
      symbol: '/archive',
    });
    // The link to it is answered by a route, so nothing may claim otherwise.
    expect(rows.find((row) => row.reason === 'route-screen-unread')).toMatchObject({
      symbol: 'CheckoutComponent /archive',
      level: 'info',
    });
    expect(rows.some((row) => row.reason === 'route-target-unresolved')).toBe(false);
  });

  it('resolves an injection written as a field the same way as one in the constructor', () => {
    const field = edgesOf(graph(), 'injects').find((edge) => edge.meta?.['via'] === 'field-inject');
    expect(field?.to).toBe('angular-basic#src/app/auth.service.ts:AuthService');
  });

  it('puts the type of every answer it could read into the registry', () => {
    const responses = nodesOf(graph(), 'ui_api_call').map((node) => node.meta?.['responseType']);
    expect(responses).toContain('type:angular-basic#OrderDto');
    expect(Object.keys(graph().types)).toContain('type:angular-basic#OrderDto');
  });

  it('says exactly what it could not follow, and nothing else', () => {
    expect(reasons(graph())).toEqual([
      'api-path-dynamic',
      'handler-not-a-method',
      'handler-not-found',
      'inject-token-unresolved',
      'route-loader-unread',
      'route-screen-unread',
      'template-not-found',
    ]);
  });
});
