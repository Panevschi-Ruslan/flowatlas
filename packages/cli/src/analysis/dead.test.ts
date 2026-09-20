import { describe, expect, it } from 'vitest';
import { deadChannels, deadEntries, deadFields, deadProviders, unresolvedInjectCount } from './dead.js';
import { buildTestDb, edge, node } from './__fixtures__/test-db.js';

const route = (id: string, over = {}) =>
  node(id, { type: 'entry', kind: 'http', file: 'src/x.ts', line: 1, ...over });

describe('entries nothing reaches', () => {
  it('reads the routes the build already found nobody calls', () => {
    const db = buildTestDb({
      nodes: [route('entry:orders:http:GET:/a'), route('entry:orders:http:GET:/b')],
      edges: [],
      report: { routes: { total: 2, called: 1, uncalled: ['entry:orders:http:GET:/b'], duplicated: [] } },
    });

    const rows = deadEntries(db, db.report());
    db.close();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'entry:orders:http:GET:/b',
      key: 'GET:/b',
      service: 'orders',
    });
    expect(rows[0]!.reason).toContain('may be a public API');
  });

  it('says which kind of row it is, rather than one sentence for four', () => {
    const uncalled = [
      'entry:orders:http:GET:/health',
      'entry:orders:http:GET:/api/_db-status',
      'entry:orders:http:GET:/api/orders/:param/stream',
      'entry:orders:http:GET:/api/tos',
      'entry:orders:http:GET:/api/orders/:param',
    ];
    const db = buildTestDb({
      nodes: uncalled.map((id) => route(id)),
      edges: [],
      report: { routes: { total: 5, called: 0, uncalled, duplicated: [] } },
    });

    const rows = deadEntries(db, db.report(), { publicRoutes: ['GET /api/tos'] });
    db.close();
    const reasonFor = (key: string) => rows.find((row) => row.key === key)?.reason ?? '';
    // The rows the command is for come first, so reading the top of the list
    // and stopping there is reading the findings and stopping there.
    expect(rows.map((row) => row.key)).toEqual([
      'GET:/api/orders/:param',
      'GET:/api/orders/:param/stream',
      'GET:/api/_db-status',
      'GET:/health',
      'GET:/api/tos',
    ]);
    expect(reasonFor('GET:/health')).toContain('probe');
    expect(reasonFor('GET:/api/_db-status')).toContain('probe');
    expect(reasonFor('GET:/api/orders/:param/stream')).toContain('event stream');
    expect(reasonFor('GET:/api/tos')).toContain('declared public');
    // Everything the four do not explain keeps the sentence it always had.
    expect(reasonFor('GET:/api/orders/:param')).toContain('may be a public API');
  });

  it('keeps an ordinary noun from reading as a probe deep in a path', () => {
    // `status` and `metrics` are words a business API uses. Near the root they
    // are a probe; three segments in they are a route somebody wrote.
    const uncalled = [
      'entry:orders:http:GET:/api/orders/:param/status',
      'entry:orders:http:GET:/api/restaurants/:param/metrics',
      'entry:orders:http:GET:/api/events',
    ];
    const db = buildTestDb({
      nodes: uncalled.map((id) => route(id)),
      edges: [],
      report: { routes: { total: 3, called: 0, uncalled, duplicated: [] } },
    });

    const rows = deadEntries(db, db.report());
    db.close();
    for (const row of rows) expect(row.reason).toContain('may be a public API');
  });

  it('reads a `-status` ending the way it reads a bare `status`', () => {
    // `payment-status` is a noun a real route uses; `_db-status` is not a name
    // anything but a probe wears, so it answers at any depth.
    const uncalled = [
      'entry:orders:http:GET:/api/orders/:param/payment-status',
      'entry:orders:http:GET:/api/_db-status',
    ];
    const db = buildTestDb({
      nodes: uncalled.map((id) => route(id)),
      edges: [],
      report: { routes: { total: 2, called: 0, uncalled, duplicated: [] } },
    });

    const rows = deadEntries(db, db.report());
    db.close();
    const reasonFor = (key: string) => rows.find((row) => row.key === key)?.reason ?? '';
    expect(reasonFor('GET:/api/orders/:param/payment-status')).toContain('may be a public API');
    expect(reasonFor('GET:/api/_db-status')).toContain('probe');
  });

  it('reads only the last segment, so a route below a probe is a route', () => {
    const uncalled = ['entry:orders:http:GET:/api/health/reports/:param'];
    const db = buildTestDb({
      nodes: uncalled.map((id) => route(id)),
      edges: [],
      report: { routes: { total: 1, called: 0, uncalled, duplicated: [] } },
    });

    const rows = deadEntries(db, db.report());
    db.close();
    expect(rows[0]!.reason).toContain('may be a public API');
  });

  it('never reports an entry something outside the graph triggers', () => {
    const db = buildTestDb({
      nodes: [
        node('entry:admin:cron:Job.hourly', { type: 'entry', kind: 'cron', repo: 'admin' }),
        node('entry:bot:bot_command:start', { type: 'entry', kind: 'bot_command', repo: 'bot' }),
      ],
      edges: [],
      report: {
        routes: {
          total: 0,
          called: 0,
          // The build lists only http routes. Handing them over anyway proves
          // the exclusion is this function's own and not something it inherits.
          uncalled: ['entry:admin:cron:Job.hourly', 'entry:bot:bot_command:start'],
          duplicated: [],
        },
      },
    });

    const rows = deadEntries(db, db.report());
    db.close();
    expect(rows).toEqual([]);
  });

  it('reports a handler whose channel nothing publishes to', () => {
    const db = buildTestDb({
      nodes: [
        node('channel:orphan.in', { type: 'channel', label: 'orphan.in' }),
        node('consumer:orders#c:C.on', {
          type: 'consumer',
          meta: { entryId: 'entry:orders:event:orphan.in' },
        }),
        node('entry:orders:event:orphan.in', { type: 'entry', kind: 'event', file: 'src/c.ts', line: 3 }),
      ],
      edges: [edge('channel:orphan.in', 'consumer:orders#c:C.on', { type: 'consumes' })],
      report: {
        channels: { total: 1, linked: 0, noConsumers: [], noProducers: ['channel:orphan.in'] },
      },
    });

    const rows = deadEntries(db, db.report());
    db.close();
    expect(rows.map((row) => row.id)).toEqual(['entry:orders:event:orphan.in']);
    expect(rows[0]!.reason).toBe('channel:orphan.in has no publisher in any repo');
  });

  it('narrows to one service when asked', () => {
    const db = buildTestDb({
      nodes: [route('entry:orders:http:GET:/a'), route('entry:gateway:http:GET:/b', { repo: 'gateway' })],
      edges: [],
      report: {
        routes: {
          total: 2,
          called: 0,
          uncalled: ['entry:orders:http:GET:/a', 'entry:gateway:http:GET:/b'],
          duplicated: [],
        },
      },
    });

    const rows = deadEntries(db, db.report(), { service: 'gateway' });
    db.close();
    expect(rows.map((row) => row.id)).toEqual(['entry:gateway:http:GET:/b']);
  });
});

describe('channels missing an end', () => {
  it('names the services on the side that exists', () => {
    const db = buildTestDb({
      nodes: [
        node('channel:audit.log', { type: 'channel', label: 'audit.log' }),
        node('producer:orders#a:1:1', { type: 'producer' }),
        node('channel:orphan.in', { type: 'channel', label: 'orphan.in' }),
        node('consumer:billing#b:B.on', { type: 'consumer', repo: 'billing' }),
      ],
      edges: [
        edge('producer:orders#a:1:1', 'channel:audit.log', { type: 'emits' }),
        edge('channel:orphan.in', 'consumer:billing#b:B.on', { type: 'consumes' }),
      ],
      report: {
        channels: {
          total: 2,
          linked: 0,
          noConsumers: ['channel:audit.log'],
          noProducers: ['channel:orphan.in'],
        },
      },
    });

    const rows = deadChannels(db, db.report());
    db.close();
    expect(rows).toEqual([
      {
        id: 'channel:audit.log',
        producers: ['orders'],
        consumers: [],
        reason: 'no consumer in any repo',
      },
      {
        id: 'channel:orphan.in',
        producers: [],
        consumers: ['billing'],
        reason: 'no producer in any repo',
      },
    ]);
  });

  it('says both things about a channel with neither end', () => {
    const db = buildTestDb({
      nodes: [node('channel:silent', { type: 'channel', label: 'silent' })],
      edges: [],
      report: {
        channels: { total: 1, linked: 0, noConsumers: ['channel:silent'], noProducers: ['channel:silent'] },
      },
    });

    const rows = deadChannels(db, db.report());
    db.close();
    expect(rows[0]!.reason).toBe('no consumer in any repo; no producer in any repo');
  });

  it('says when the consumer it could not read is a browser holding a stream', () => {
    // The service publishes and also answers a subscription. "No consumer in
    // any repo" there reads as "delete the publisher", and the screens that
    // consume it go dark (R22).
    const db = buildTestDb({
      nodes: [
        node('channel:order:*:created', { type: 'channel', label: 'order:*:created' }),
        node('producer:orders#a:1:1', { type: 'producer', repo: 'orders' }),
        node('entry:orders:http:GET:/orders/:param/stream', {
          type: 'entry',
          kind: 'http',
          repo: 'orders',
        }),
        node('ui_api_call:web#s.ts:1:1', { type: 'ui_api_call', kind: 'sse', repo: 'web' }),
      ],
      edges: [
        edge('producer:orders#a:1:1', 'channel:order:*:created', { type: 'emits' }),
        edge('ui_api_call:web#s.ts:1:1', 'entry:orders:http:GET:/orders/:param/stream', {
          type: 'hits',
        }),
      ],
      report: {
        channels: { total: 1, linked: 0, noConsumers: ['channel:order:*:created'], noProducers: [] },
      },
    });

    const rows = deadChannels(db, db.report());
    db.close();
    expect(rows[0]?.reason).toBe(
      'no consumer in any repo; orders serves 1 event stream, whose consumers are not read yet',
    );
  });

  it('counts the routes held open, not the screens holding them', () => {
    // Two screens subscribing to one stream are one route. Counting the
    // subscriptions would say a service serves more streams than it declares.
    const db = buildTestDb({
      nodes: [
        node('channel:order:*:created', { type: 'channel', label: 'order:*:created' }),
        node('producer:orders#a:1:1', { type: 'producer', repo: 'orders' }),
        node('entry:orders:http:GET:/orders/:param/stream', {
          type: 'entry',
          kind: 'http',
          repo: 'orders',
        }),
        node('ui_api_call:web#a.ts:1:1', { type: 'ui_api_call', kind: 'sse', repo: 'web' }),
        node('ui_api_call:web#b.ts:1:1', { type: 'ui_api_call', kind: 'sse', repo: 'web' }),
      ],
      edges: [
        edge('producer:orders#a:1:1', 'channel:order:*:created', { type: 'emits' }),
        edge('ui_api_call:web#a.ts:1:1', 'entry:orders:http:GET:/orders/:param/stream', {
          type: 'hits',
        }),
        edge('ui_api_call:web#b.ts:1:1', 'entry:orders:http:GET:/orders/:param/stream', {
          type: 'hits',
        }),
      ],
      report: {
        channels: { total: 1, linked: 0, noConsumers: ['channel:order:*:created'], noProducers: [] },
      },
    });

    const rows = deadChannels(db, db.report());
    db.close();
    expect(rows[0]?.reason).toBe(
      'no consumer in any repo; orders serves 1 event stream, whose consumers are not read yet',
    );
  });
});

describe('providers nothing injects', () => {
  const provider = (id: string, over = {}) =>
    node(id, { type: 'provider', kind: 'injectable', file: 'src/p.ts', line: 1, ...over });

  it('reports one nothing injects and nothing calls into', () => {
    const db = buildTestDb({
      nodes: [
        provider('orders#src/p.ts:Unused'),
        provider('orders#src/p.ts:Used'),
        node('orders#src/p.ts:Used.run'),
        provider('orders#src/p.ts:Caller'),
      ],
      edges: [edge('orders#src/p.ts:Caller', 'orders#src/p.ts:Used', { type: 'injects' })],
    });

    const rows = deadProviders(db);
    db.close();
    expect(rows.map((row) => row.id)).toEqual(['orders#src/p.ts:Caller', 'orders#src/p.ts:Unused']);
  });

  it('never reports a controller or a class from a library', () => {
    const db = buildTestDb({
      nodes: [
        provider('orders#src/c.ts:OrdersController', { kind: 'controller' }),
        provider('orders#node_modules/@nestjs/config:ConfigService', { kind: 'external' }),
      ],
      edges: [],
    });

    const rows = deadProviders(db);
    db.close();
    expect(rows).toEqual([]);
  });

  it('never reports a provider its module exports', () => {
    const db = buildTestDb({
      nodes: [
        provider('orders#src/p.ts:Shared', { label: 'Shared' }),
        node('orders#src/app.module.ts:AppModule', {
          type: 'module',
          meta: { exports: ['Shared'] },
        }),
      ],
      edges: [],
    });

    const rows = deadProviders(db);
    db.close();
    expect(rows).toEqual([]);
  });

  it('never reports a class a route hands work to', () => {
    const db = buildTestDb({
      nodes: [
        provider('orders#src/p.ts:Handler'),
        node('orders#src/p.ts:Handler.run'),
        node('entry:orders:http:GET:/a', { type: 'entry', kind: 'http' }),
      ],
      edges: [edge('entry:orders:http:GET:/a', 'orders#src/p.ts:Handler.run', { type: 'handles' })],
    });

    const rows = deadProviders(db);
    db.close();
    expect(rows).toEqual([]);
  });

  it('points at the bootstrap file when no module registers the class at all', () => {
    const db = buildTestDb({
      nodes: [
        provider('orders#src/f.ts:Filter', { label: 'Filter' }),
        provider('orders#src/p.ts:Listed', { label: 'Listed' }),
        node('orders#src/app.module.ts:AppModule', {
          type: 'module',
          meta: { providers: ['Listed'] },
        }),
      ],
      edges: [],
    });

    const rows = deadProviders(db);
    db.close();
    // The container never builds the first one, so whatever wires it does so
    // somewhere this graph does not reach.
    expect(rows[0]!.reason).toContain('no module registers it either');
    expect(rows[1]!.reason).not.toContain('no module registers it');
  });

  it('says how many injects the service could not resolve, so a row can be doubted', () => {
    const db = buildTestDb({
      nodes: [node('orders#src/p.ts:Unused', { type: 'provider', kind: 'injectable' })],
      edges: [],
      unresolved: [
        { reason: 'di-token-unknown', file: 'src/x.ts', line: 1, service: 'orders' },
        { reason: 'dynamic-config-key', file: 'src/y.ts', line: 2, service: 'orders' },
      ],
    });

    const rows = deadProviders(db);
    const count = unresolvedInjectCount(db);
    db.close();
    expect(rows[0]!.reason).toContain('orders has 1 unresolved injects');
    expect(count).toBe(1);
  });
});

describe('fields the receiver does not declare', () => {
  it('asks the contract checker, and says nothing crosses a boundary here', async () => {
    // It used to answer `contracts-unavailable`, because the checker was a
    // later phase. It exists now, and an empty graph has no boundary to send a
    // field over. The warning is still what a checkout without it would get.
    const db = buildTestDb({ nodes: [], edges: [] });
    const result = await deadFields(db);
    db.close();

    expect(result.fields).toEqual([]);
    expect(result.warning).toBeUndefined();
  });

  it('names a field one service sends that the other does not declare', async () => {
    const db = buildTestDb({
      nodes: [
        { id: 'http_out:web#1', type: 'http_out', label: 'post', repo: 'web' },
        { id: 'entry:api:http:POST:/orders', type: 'entry', kind: 'http', label: 'POST /orders', repo: 'api' },
        { id: 'api#Controller.create', type: 'method', label: 'create', repo: 'api' },
      ],
      edges: [
        {
          from: 'http_out:web#1',
          to: 'entry:api:http:POST:/orders',
          type: 'http_calls',
          confidence: 'static',
          params: ['type:web#Body'],
        },
        {
          from: 'entry:api:http:POST:/orders',
          to: 'api#Controller.create',
          type: 'handles',
          confidence: 'static',
          meta: { body: 'type:api#Body' },
        },
      ],
      types: {
        'type:web#Body': {
          name: 'Body',
          kind: 'object',
          declaredIn: 'web#src/dto.ts',
          structuralHash: 'aaa',
          fields: [
            { name: 'id', type: 'string', optional: false },
            { name: 'debugId', type: 'string', optional: false },
          ],
        },
        'type:api#Body': {
          name: 'Body',
          kind: 'object',
          declaredIn: 'api#src/dto.ts',
          structuralHash: 'bbb',
          fields: [{ name: 'id', type: 'string', optional: false }],
        },
      },
    });
    const result = await deadFields(db);
    db.close();

    expect(result.fields.map((row) => `${row.typeId} ${row.field}`)).toEqual([
      'type:api#Body debugId',
    ]);
    // Travelling into the receiver, and nothing there removes it: this graph
    // has no whitelisting pipe, so the row must not claim one. What the
    // checker read, not what the direction suggests.
    expect(result.fields[0]?.direction).toBe('request');
    expect(result.fields[0]?.dropped).toBe(false);
    expect(result.fields[0]?.reason).toContain('nothing there removes it');
  });
});
