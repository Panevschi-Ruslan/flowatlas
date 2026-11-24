import { describe, expect, it } from 'vitest';
import { likelyRenamed, nearestRoutes, promoteGap, routesReadOf, typesNeverPublished } from './boundary.js';
import { collectFindings, rankFindings } from './findings.js';
import { buildTestDb, edge, node } from './__fixtures__/test-db.js';

const route = (service: string, method: string, path: string, over = {}) =>
  node(`entry:${service}:http:${method}:${path}`, {
    type: 'entry',
    kind: 'http',
    repo: service,
    label: `${method} ${path}`,
    meta: { method, path, controller: 'ItemsController' },
    ...over,
  });

const noRoute = (target: string, method: string, path: string, requestId: string) => ({
  service: 'shop',
  file: 'src/items.client.ts',
  line: 12,
  reason: 'target-route-not-found',
  level: 'action' as const,
  message: `target service ${target} has no route ${method} ${path}`,
  symbol: requestId,
});

/** What looks broken between the services (P384), each gated on the fact that makes it a defect. */
describe('defects between the services', () => {
  const request = 'http_out:shop#src/items.client.ts:12:5';
  const graph = (extra: { unresolved?: object[]; nodes?: ReturnType<typeof node>[] } = {}) =>
    buildTestDb({
      services: ['shop', 'items'],
      nodes: [
        route('items', 'POST', '/items/:param/publish'),
        route('items', 'GET', '/items/:param'),
        route('shop', 'POST', '/shop/items/:param/release', { meta: { method: 'POST', path: '/shop/items/:param/release' } }),
        node('shop#src/shop.controller.ts:ShopController.release', { repo: 'shop' }),
        node('shop#src/items.client.ts:ItemsClient.release', { repo: 'shop', label: 'ItemsClient.release' }),
        node(request, { type: 'http_out', repo: 'shop', label: 'POST /items/:param/release', meta: { method: 'POST', path: '/items/:param/release' } }),
        ...(extra.nodes ?? []),
      ],
      edges: [
        edge('entry:shop:http:POST:/shop/items/:param/release', 'shop#src/shop.controller.ts:ShopController.release', { type: 'handles' }),
        edge('shop#src/shop.controller.ts:ShopController.release', 'shop#src/items.client.ts:ItemsClient.release'),
        edge('shop#src/items.client.ts:ItemsClient.release', request),
      ],
      unresolved: [noRoute('items', 'POST', '/items/:param/release', request), ...((extra.unresolved ?? []) as never[])],
    });

  it('names a call to a route that does not exist where every route of its target was read, with the nearest route and who meets it', () => {
    const db = graph();
    const rows = db.allUnresolved();
    const promoted = promoteGap(db, rows[0]!, rows);
    db.close();
    expect(promoted).toMatchObject({
      finding: {
        kind: 'call-to-missing-route',
        id: request,
        precision: 'high',
        message: 'ItemsClient.release sends POST /items/:param/release to items, which serves no such route',
        fix: 'the nearest route: POST /items/:param/publish (one segment off: release for publish)',
        nearest: ['entry:items:http:POST:/items/:param/publish'],
        seenBy: ['POST /shop/items/:param/release (shop)'],
        to: 'items',
      },
    });
  });

  it('holds it back where some route of the target was not read, and says why', () => {
    const db = graph({
      unresolved: [{ service: 'items', file: 'src/legacy.controller.ts', line: 3, reason: 'route-path-dynamic', level: 'action', message: 'LegacyController' }],
    });
    const rows = db.allUnresolved();
    const { findings, heldBack } = collectFindings(db, { rows });
    db.close();
    expect(findings.filter((row) => row.kind === 'call-to-missing-route')).toEqual([]);
    expect(heldBack).toEqual({ 'call-to-missing-route': { count: 1, why: 'some routes of items were not read (route-path-dynamic)' } });
  });

  it('holds it back where a catch-all of the target may answer it', () => {
    const db = graph({ nodes: [route('items', 'GET', '/files/*')] });
    expect(routesReadOf(db, 'items', db.allUnresolved())).toEqual({ whole: false, why: 'GET /files/* of items may answer it' });
    db.close();
  });

  it('names the same path under another verb and the path under a prefix as the nearest routes', () => {
    const db = buildTestDb({
      services: ['items'],
      nodes: [route('items', 'PUT', '/items/:param'), route('items', 'GET', '/api/v1/items/:param')],
      edges: [],
    });
    expect(nearestRoutes(db, 'items', 'GET', '/items/:param').map((each) => each.said)).toEqual([
      'PUT /items/:param (the same path under PUT)',
      'GET /api/v1/items/:param (served under /api/v1)',
    ]);
    db.close();
  });

  it('reads a rename off a shared word or a near spelling, and guesses none on a tie', () => {
    expect(likelyRenamed('deskId', ['deskNumber', 'note'])).toBe('deskNumber');
    expect(likelyRenamed('LISTING_CANCELED', ['LISTING_CANCELLED', 'PRODUCT_CREATED'])).toBe('LISTING_CANCELLED');
    expect(likelyRenamed('PRODUCT_ARCHIVED', ['PRODUCT_CREATED', 'PRODUCT_REMOVED'])).toBeUndefined();
    expect(likelyRenamed('total', ['note'])).toBeUndefined();
  });

  it('names a type of message handled that no publish sends, and holds it back where a publish sends a type not read', () => {
    const channel = node('channel:catalog', { type: 'channel', label: 'catalog', repo: 'items' });
    const handler = node('consumer:shop#src/events.ts:Events.on', {
      type: 'consumer',
      repo: 'shop',
      file: 'src/events.ts',
      line: 4,
      label: 'Events.on',
      meta: {
        selects: [
          { type: 'ITEM_ADDED', consumer: 'consumer:shop#src/events.ts:Events.on', via: 'switch', line: 6 },
          { type: 'ITEM_CANCELED', consumer: 'consumer:shop#src/events.ts:Events.on', via: 'switch', line: 9 },
        ],
      },
    });
    const publish = (line: number, over: Record<string, unknown>) => node(`producer:items#src/items.ts:${line}:3`, { type: 'producer', repo: 'items', meta: over });
    const build = (unread: boolean) =>
      buildTestDb({
        services: ['shop', 'items'],
        nodes: [
          channel,
          handler,
          publish(10, { messageTypes: ['ITEM_ADDED'] }),
          publish(20, unread ? { messageTypeUnread: 'kind' } : { messageTypes: ['ITEM_CANCELLED'] }),
        ],
        edges: [
          edge('producer:items#src/items.ts:10:3', 'channel:catalog', { type: 'emits' }),
          edge('producer:items#src/items.ts:20:3', 'channel:catalog', { type: 'emits' }),
          edge('channel:catalog', handler.id, { type: 'consumes' }),
        ],
      });
    const sure = build(false);
    expect(typesNeverPublished(sure)).toMatchObject([
      {
        finding: {
          kind: 'type-never-published',
          id: 'channel:catalog#ITEM_CANCELED',
          loc: 'src/events.ts:9',
          precision: 'high',
          fix: 'likely renamed: ITEM_CANCELLED is published, ITEM_CANCELED is handled',
        },
      },
    ]);
    sure.close();
    const unsure = build(true);
    expect(typesNeverPublished(unsure)).toEqual([
      { held: { kind: 'type-never-published', id: 'channel:catalog#ITEM_CANCELED', why: '1 publish(es) on catalog send a type not read' } },
    ]);
    unsure.close();
  });

  it('lists an unguarded route among guarded siblings as its own kind, ranked above a plain unguarded one', () => {
    const guard = node('items#src/staff.guard.ts:StaffGuard', { type: 'guard', repo: 'items', label: 'StaffGuard' });
    const unguarded = (method: string, path: string, line: number) => ({
      service: 'items',
      file: 'src/items.controller.ts',
      line,
      reason: 'route-unguarded',
      level: 'action' as const,
      message: `${method} ${path} has no guard in front of it and reaches items.`,
      symbol: `${method} ${path}`,
    });
    const db = buildTestDb({
      services: ['items'],
      nodes: [
        route('items', 'GET', '/items/:param'),
        route('items', 'DELETE', '/items/:param'),
        route('items', 'GET', '/stock/:param', { meta: { method: 'GET', path: '/stock/:param', controller: 'StockController' } }),
        guard,
      ],
      edges: [edge('entry:items:http:GET:/items/:param', guard.id, { type: 'guarded_by', meta: { layer: 'guard' } })],
      unresolved: [unguarded('DELETE', '/items/:param', 20), unguarded('GET', '/stock/:param', 30)],
    });
    const rows = db.allUnresolved();
    const ranked = rankFindings(db, collectFindings(db, { rows }).findings);
    db.close();
    expect(ranked.map((row) => `${row.kind} ${row.id} ${row.precision}`)).toEqual([
      'unguarded-among-guarded entry:items:http:DELETE:/items/:param medium',
      'unguarded entry:items:http:GET:/stock/:param low',
    ]);
    expect(ranked[0]?.message).toBe(
      'DELETE /items/:param has no guard in front of it and reaches items, while 1 of the 1 other routes of ItemsController have StaffGuard in front',
    );
  });
});
