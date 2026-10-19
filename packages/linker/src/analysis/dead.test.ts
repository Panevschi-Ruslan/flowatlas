import { describe, expect, it } from 'vitest';
import { deadChannels, deadEntries, deadMethods, deadProviders, deadVerdict, unresolvedInjectCount } from './dead.js';
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
      'entry:orders:http:GET:/api/stores/:param/metrics',
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
        verdict: 'dead',
        evidence: { missing: 'consumer' },
      },
      {
        id: 'channel:orphan.in',
        producers: [],
        consumers: ['billing'],
        reason: 'no producer in any repo',
        verdict: 'dead',
        evidence: { missing: 'producer' },
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
    expect(rows[0]!.evidence).toEqual({ missing: 'both' });
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
    // Its consumer may be a browser holding the stream open: the graph's silence says nothing (P95).
    expect(rows[0]).toMatchObject({ verdict: 'unknown', evidence: { missing: 'consumer', outside: 'stream' } });
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

/**
 * Routes something outside the project calls, told from the routes nobody
 * calls (P91): each rule, what the configuration adds, and what it takes away.
 */
describe('routes called from outside the project', () => {
  const uncalledIn = (nodes: ReturnType<typeof route>[], edges: ReturnType<typeof edge>[] = [], nearMissed?: Record<string, string[]>) =>
    buildTestDb({
      nodes,
      edges,
      report: {
        routes: {
          total: nodes.length,
          called: 0,
          uncalled: nodes.filter((each) => each.type === 'entry').map((each) => each.id),
          duplicated: [],
          ...(nearMissed === undefined ? {} : { nearMissed }),
        },
      },
    });
  const handled = (id: string, handler: string) => edge(id, handler, { type: 'handles' });

  it('reads a probe, a webhook, a callback and a well-known address by their path', () => {
    const db = uncalledIn([
      route('entry:orders:http:GET:/healthz'),
      route('entry:orders:http:POST:/webhooks/payments'),
      route('entry:orders:http:GET:/oauth/callback'),
      route('entry:orders:http:GET:/.well-known/openid-configuration'),
      route('entry:orders:http:POST:/payments/notify'),
    ]);
    const rows = deadEntries(db, db.report());
    db.close();
    expect(rows.map((row) => `${row.key} ${row.class} ${row.role ?? ''} ${row.why}`)).toEqual([
      'GET:/.well-known/openid-configuration infrastructure discovery path /.well-known/openid-configuration',
      'GET:/healthz infrastructure probe path /healthz',
      'GET:/oauth/callback infrastructure callback path /oauth/callback',
      'POST:/payments/notify infrastructure webhook path /payments/notify',
      'POST:/webhooks/payments infrastructure webhook path /webhooks/payments',
    ]);
  });

  it('keeps a list a screen reads as a route, whatever it is called', () => {
    const db = uncalledIn([route('entry:orders:http:GET:/users/:param/notifications')]);
    const rows = deadEntries(db, db.report());
    db.close();
    expect(rows.map((row) => row.class)).toEqual(['actionable']);
  });

  it('reads a probe decorator, and a handler or controller named for what it answers', () => {
    const db = uncalledIn(
      [
        route('entry:orders:http:GET:/ready', { meta: { method: 'GET', path: '/ready', decorators: [{ name: 'HealthCheck', args: [] }] } }),
        route('entry:orders:http:POST:/stripe', { meta: { method: 'POST', path: '/stripe', controller: 'PaymentsController' } }),
        route('entry:orders:http:GET:/up', { meta: { method: 'GET', path: '/up', controller: 'HealthController' } }),
        route('entry:orders:http:GET:/settings/hooks-list', { meta: { method: 'GET', path: '/settings/hooks-list', controller: 'SettingsController' } }),
        node('orders#src/p.ts:PaymentsController.stripeWebhook', { label: 'PaymentsController.stripeWebhook' }),
        node('orders#src/s.ts:SettingsController.fetchWebhookSettings', { label: 'SettingsController.fetchWebhookSettings' }),
      ],
      [
        handled('entry:orders:http:POST:/stripe', 'orders#src/p.ts:PaymentsController.stripeWebhook'),
        handled('entry:orders:http:GET:/settings/hooks-list', 'orders#src/s.ts:SettingsController.fetchWebhookSettings'),
      ],
    );
    const rows = deadEntries(db, db.report());
    db.close();
    expect(rows.map((row) => `${row.key} ${row.class} ${row.why}`)).toEqual([
      'GET:/settings/hooks-list actionable no caller read',
      'GET:/ready infrastructure decorator @HealthCheck',
      'GET:/up infrastructure name HealthController',
      'POST:/stripe infrastructure name stripeWebhook',
    ]);
  });

  it('adds what the configuration names, and drops the built-in rules when told to', () => {
    const nodes = [
      route('entry:orders:http:POST:/inbound/sms'),
      route('entry:orders:http:GET:/ping'),
      route('entry:orders:http:GET:/admin/sync', { meta: { method: 'GET', path: '/admin/sync', decorators: [{ name: 'Scheduled', args: [] }] } }),
      route('entry:orders:http:GET:/admin/flush', { meta: { method: 'GET', path: '/admin/flush', controller: 'OpsController' } }),
    ];
    const infrastructure = { paths: ['POST /inbound/*'], decorators: ['Scheduled'], names: ['OpsController'], builtIn: true };
    const db = uncalledIn(nodes);
    const configured = deadEntries(db, db.report(), { infrastructure });
    const plain = deadEntries(db, db.report(), { infrastructure: { ...infrastructure, builtIn: false } });
    db.close();
    expect(configured.map((row) => `${row.key} ${row.role ?? row.class} ${row.why}`)).toEqual([
      'GET:/admin/flush configured dead.infrastructure.names OpsController',
      'GET:/admin/sync configured dead.infrastructure.decorators @Scheduled',
      'GET:/ping probe path /ping',
      'POST:/inbound/sms configured dead.infrastructure.paths POST /inbound/*',
    ]);
    expect(plain.find((row) => row.key === 'GET:/ping')?.class).toBe('actionable');
    expect(plain.filter((row) => row.role === 'configured')).toHaveLength(3);
  });

  it('reads a route the code declares public as declared, never as dead evidence', () => {
    const db = uncalledIn([
      route('entry:orders:http:GET:/terms', { meta: { method: 'GET', path: '/terms', publicNote: 'shown before sign-in' } }),
    ]);
    const rows = deadEntries(db, db.report());
    db.close();
    expect(rows.map((row) => `${row.class} ${row.why}`)).toEqual(['declared @flowatlas-public shown before sign-in']);
  });

  it('calls a route a partly read request could reach likely-dead, names the request, and ranks it after the dead', () => {
    const db = uncalledIn(
      [
        route('entry:orders:http:GET:/items/:param/price'),
        route('entry:orders:http:GET:/items/export'),
        route('entry:orders:http:GET:/healthz'),
        node('ui_api_call:web#src/a.ts:9:3', { type: 'ui_api_call', repo: 'web', file: 'src/a.ts', line: 9, meta: { path: '/items/:param/${…}' } }),
      ],
      [],
      { 'entry:orders:http:GET:/items/:param/price': ['ui_api_call:web#src/a.ts:9:3'] },
    );
    const rows = deadEntries(db, db.report());
    const onlyActionable = deadEntries(db, db.report(), { class: 'actionable' });
    db.close();
    expect(rows.map((row) => `${row.key} ${row.confidence}`)).toEqual([
      'GET:/items/export dead',
      'GET:/items/:param/price likely-dead',
      'GET:/healthz dead',
    ]);
    expect(rows[1]?.evidence?.couldHit).toEqual([{ call: 'ui_api_call:web#src/a.ts:9:3', path: '/items/:param/${…}', file: 'src/a.ts', line: 9 }]);
    expect(onlyActionable.map((row) => row.key)).toEqual(['GET:/items/export', 'GET:/items/:param/price']);
  });
});

/**
 * A verdict with its evidence (P95): what `dead` claims about one node, and
 * what could make the claim wrong.
 */
describe('verdicts', () => {
  const report = (uncalled: string[], extra: Record<string, unknown> = {}) => ({
    routes: { total: uncalled.length, called: 0, uncalled, duplicated: [], ...extra },
  });

  it('says dead where nothing reaches a route and nothing that could is unread', () => {
    const db = buildTestDb({ nodes: [route('entry:orders:http:GET:/export')], edges: [], report: report(['entry:orders:http:GET:/export']) });
    const answer = deadVerdict(db, db.report(), 'entry:orders:http:GET:/export');
    db.close();
    expect(answer).toMatchObject({ verdict: 'dead', class: 'actionable', evidence: {} });
  });

  it('says likely-dead with the call that could hit it, read off the report rather than matched again', () => {
    const db = buildTestDb({
      nodes: [
        route('entry:orders:http:GET:/items/:param/price'),
        node('ui_api_call:web#src/a.ts:9:3', { type: 'ui_api_call', repo: 'web', file: 'src/a.ts', line: 9, meta: { path: '/items/:param/${…}' } }),
      ],
      edges: [],
      report: report(['entry:orders:http:GET:/items/:param/price'], {
        nearMissed: { 'entry:orders:http:GET:/items/:param/price': ['ui_api_call:web#src/a.ts:9:3'] },
      }),
    });
    const answer = deadVerdict(db, db.report(), 'entry:orders:http:GET:/items/:param/price');
    db.close();
    expect(answer?.verdict).toBe('likely-dead');
    expect(answer?.evidence.couldHit).toEqual([{ call: 'ui_api_call:web#src/a.ts:9:3', path: '/items/:param/${…}', file: 'src/a.ts', line: 9 }]);
  });

  it('says unknown where a call that found no route is one segment off it, and names the difference', () => {
    const shipped = route('entry:orders:http:POST:/orders/:param/ship', { meta: { method: 'POST', path: '/orders/:param/ship' } });
    const archived = route('entry:orders:http:POST:/orders/:param/archive', { meta: { method: 'POST', path: '/orders/:param/archive' } });
    const db = buildTestDb({
      nodes: [
        shipped,
        archived,
        node('http_out:gateway#src/c.ts:4:1', { type: 'http_out', repo: 'gateway', file: 'src/c.ts', line: 4, meta: { method: 'POST', path: '/orders/ship', targetService: 'orders' } }),
        node('http_out:gateway#src/c.ts:9:1', { type: 'http_out', repo: 'gateway', file: 'src/c.ts', line: 9, meta: { method: 'POST', path: '/orders/:param/cancel' } }),
      ],
      edges: [],
      unresolved: [
        { service: 'gateway', file: 'src/c.ts', line: 4, reason: 'target-route-not-found', message: 'target service orders has no route POST /orders/ship', symbol: 'http_out:gateway#src/c.ts:4:1' },
        { service: 'gateway', file: 'src/c.ts', line: 9, reason: 'target-route-not-found', message: 'target service orders has no route POST /orders/:param/cancel', symbol: 'http_out:gateway#src/c.ts:9:1' },
      ],
      report: report([shipped.id, archived.id]),
    });
    const ship = deadVerdict(db, db.report(), shipped.id);
    const rows = deadEntries(db, db.report());
    db.close();
    expect(ship?.verdict).toBe('unknown');
    // Both calls are one segment off it: the one that leaves the value out, and the one that names another verb.
    expect(ship?.evidence.oneOff).toEqual([
      { call: 'http_out:gateway#src/c.ts:4:1', asks: 'POST /orders/ship', differs: ':param left out', file: 'src/c.ts', line: 4 },
      { call: 'http_out:gateway#src/c.ts:9:1', asks: 'POST /orders/:param/cancel', differs: 'cancel for ship', file: 'src/c.ts', line: 9 },
    ]);
    // The list says the same, and ranks the calls one segment off after the dead.
    expect(rows.map((row) => `${row.key} ${row.verdict} ${row.evidence?.oneOff?.[0]?.differs ?? ''}`)).toEqual([
      'POST:/orders/:param/archive unknown cancel for archive',
      'POST:/orders/:param/ship unknown :param left out',
    ]);
  });

  it('says unknown, outside, for a way in something outside the graph triggers and for infrastructure', () => {
    const db = buildTestDb({
      nodes: [node('entry:orders:cron:nightly', { type: 'entry', kind: 'cron' }), route('entry:orders:http:GET:/healthz')],
      edges: [],
      report: report(['entry:orders:http:GET:/healthz']),
    });
    const cron = deadVerdict(db, db.report(), 'entry:orders:cron:nightly');
    const probe = deadVerdict(db, db.report(), 'entry:orders:http:GET:/healthz');
    db.close();
    expect(cron).toMatchObject({ verdict: 'unknown', evidence: { outside: 'cron' } });
    expect(probe).toMatchObject({ verdict: 'unknown', class: 'infrastructure', evidence: { outside: 'probe' } });
  });

  it('says alive with one caller, and how many, for a route, a class and a method something reaches', () => {
    const db = buildTestDb({
      nodes: [
        route('entry:orders:http:GET:/a'),
        node('orders#src/s.ts:Svc', { type: 'provider', kind: 'injectable', label: 'Svc', file: 'src/s.ts', line: 1 }),
        node('orders#src/s.ts:Svc.used'),
        node('orders#src/s.ts:Svc.unused'),
        node('orders#src/c.ts:Ctl.list'),
        node('http_out:web#1', { type: 'http_out', repo: 'web' }),
      ],
      edges: [
        edge('http_out:web#1', 'entry:orders:http:GET:/a', { type: 'http_calls' }),
        edge('entry:orders:http:GET:/a', 'orders#src/c.ts:Ctl.list', { type: 'handles' }),
        edge('orders#src/c.ts:Ctl.list', 'orders#src/s.ts:Svc.used'),
      ],
      report: report([]),
    });
    const routeAnswer = deadVerdict(db, db.report(), 'entry:orders:http:GET:/a');
    const svc = deadVerdict(db, db.report(), 'orders#src/s.ts:Svc');
    const unused = deadVerdict(db, db.report(), 'orders#src/s.ts:Svc.unused');
    const providers = deadProviders(db);
    const methods = deadMethods(db);
    db.close();
    expect(routeAnswer).toMatchObject({ verdict: 'alive', evidence: { callers: 1, caller: 'http_out:web#1' } });
    expect(svc).toMatchObject({ verdict: 'alive', evidence: { callers: 1, caller: 'orders#src/c.ts:Ctl.list' } });
    // Not listed among the dead classes, since a method of it is reached.
    expect(providers).toEqual([]);
    // A method nothing calls on a class that is used: a call the reading could not type may reach it (I3).
    expect(unused).toMatchObject({ verdict: 'likely-dead', evidence: { classReached: true } });
    expect(methods.map((row) => `${row.id} ${row.verdict}`)).toEqual(['orders#src/s.ts:Svc.unused likely-dead']);
  });

  it('says dead for a method on a class nothing reaches, and likely-dead where injects did not resolve', () => {
    const db = buildTestDb({
      nodes: [
        node('orders#src/s.ts:Lost', { type: 'provider', kind: 'injectable', label: 'Lost' }),
        node('orders#src/s.ts:Lost.run'),
      ],
      edges: [],
    });
    const run = deadVerdict(db, db.report(), 'orders#src/s.ts:Lost.run');
    db.close();
    expect(run?.verdict).toBe('dead');

    const doubted = buildTestDb({
      nodes: [node('orders#src/s.ts:Lost', { type: 'provider', kind: 'injectable', label: 'Lost' })],
      edges: [],
      unresolved: [{ service: 'orders', file: 'src/m.ts', line: 1, reason: 'di-token-unknown', message: 'unknown token' }],
    });
    const lost = deadVerdict(doubted, doubted.report(), 'orders#src/s.ts:Lost');
    const listed = deadProviders(doubted);
    doubted.close();
    expect(lost).toMatchObject({ verdict: 'likely-dead', evidence: { unresolvedInjects: 1 } });
    expect(listed.map((row) => row.verdict)).toEqual(['likely-dead']);
  });

  it('answers a controller by its routes, and a channel by its ends', () => {
    const db = buildTestDb({
      nodes: [
        node('orders#src/c.ts:Ctl', { type: 'provider', kind: 'controller', label: 'Ctl' }),
        node('orders#src/c.ts:Ctl.list'),
        route('entry:orders:http:GET:/list'),
        node('channel:order.archived', { type: 'channel', label: 'order.archived' }),
        node('producer:orders#a:1:1', { type: 'producer' }),
      ],
      edges: [
        edge('entry:orders:http:GET:/list', 'orders#src/c.ts:Ctl.list', { type: 'handles' }),
        edge('producer:orders#a:1:1', 'channel:order.archived', { type: 'emits' }),
      ],
      report: {
        ...report(['entry:orders:http:GET:/list']),
        channels: { total: 1, linked: 0, noConsumers: ['channel:order.archived'], noProducers: [] },
      },
    });
    const controller = deadVerdict(db, db.report(), 'orders#src/c.ts:Ctl');
    const channel = deadVerdict(db, db.report(), 'channel:order.archived');
    const missing = deadVerdict(db, db.report(), 'nothing:here');
    db.close();
    expect(controller).toMatchObject({ verdict: 'dead', evidence: { via: 'entry:orders:http:GET:/list' } });
    expect(channel).toMatchObject({ verdict: 'dead', evidence: { missing: 'consumer' } });
    expect(missing).toBeUndefined();
  });
});
