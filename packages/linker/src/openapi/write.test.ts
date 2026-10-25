import { lookupOf } from '@flowatlas/contracts';
import { describe, expect, it } from 'vitest';
import { specGraph } from '../document/__fixtures__/spec-graph.js';
import { verifyWritten } from '../document/verify.js';
import { routeInventory } from '../document/inventory.js';
import { readOpenapiDocument } from './read.js';
import { writeOpenapiDocument, writeOpenapiDocuments } from './write.js';

const lookup = lookupOf(specGraph());
const written = writeOpenapiDocument(lookup, 'orders', { publicRoutes: [] })!;
const doc = written.document as { paths: Record<string, Record<string, Record<string, unknown>>>; components: { schemas: Record<string, Record<string, unknown>> } };

describe('writeOpenapiDocument (P118)', () => {
  it('writes an OpenAPI 3.1 document with the routes it read, in a fixed order', () => {
    expect(doc).toMatchObject({ openapi: '3.1.0', info: { title: 'orders', version: 'unversioned' } });
    expect(Object.keys(doc.paths)).toEqual(['/health', '/orders', '/orders/{id}']);
    expect(written.operations.map((operation) => operation.key)).toEqual(['GET /health', 'GET /orders', 'POST /orders', 'GET /orders/{id}']);
  });

  it('leaves out what it cannot write and counts it by reason (I3)', () => {
    expect(written.omitted).toEqual({ 'any-verb': 1, 'path-unread': 1 });
    expect(doc['x-flowatlas-omitted' as keyof typeof doc]).toEqual({ 'any-verb': 1, 'path-unread': 1 });
  });

  it('names path parameters as the registration wrote them, and writes query and header values (P29, P34)', () => {
    const parameters = doc.paths['/orders/{id}']!['get']!['parameters'];
    expect(parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'page', in: 'query', required: false, schema: { type: 'number' } },
      { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
      { name: 'x-shop', in: 'header', required: true, schema: { type: 'string' } },
    ]);
  });

  it('writes the body as it goes over the wire, through the contract check\'s wire rules (D1)', () => {
    const body = doc.components.schemas['CreateOrder']!;
    const properties = body['properties'] as Record<string, unknown>;
    expect(Object.keys(properties)).toEqual(['customerId', 'placedAt', 'note', 'coupon_code', 'discount', 'extras', 'lines', 'status', 'tags', 'gift']);
    expect(properties['placedAt']).toEqual({ type: 'string', format: 'date-time' });
    expect(properties['note']).toEqual({ type: 'string' });
    expect(properties['discount']).toEqual({ 'x-flowatlas-unread': 'transformed' });
    expect(properties['extras']).toEqual({ 'x-flowatlas-unread': 'any-typed' });
    expect(properties['tags']).toEqual({ type: 'array', items: { type: 'string' } });
    expect(properties['status']).toEqual({ $ref: '#/components/schemas/Status' });
    // A receiving validator that skips a missing value skips null too.
    expect(properties['gift']).toEqual({ type: ['string', 'null'] });
    expect(body['required']).toEqual(['customerId', 'placedAt', 'coupon_code', 'discount', 'extras', 'lines', 'status', 'tags']);
    expect(doc.components.schemas['Status']).toMatchObject({ type: 'string', enum: ['open', 'closed'] });
  });

  it('writes a shape that contains itself as a reference to itself (I5)', () => {
    expect(doc.components.schemas['Category']!['properties']).toEqual({
      id: { type: 'string' },
      children: { type: 'array', items: { $ref: '#/components/schemas/Category' } },
    });
  });

  it('expands a generic with what it is given, and says what a package type is not', () => {
    expect(doc.components.schemas['Paginated_Order']!['properties']).toEqual({
      items: { type: 'array', items: { $ref: '#/components/schemas/Order' } },
      total: { type: 'number' },
    });
    expect((doc.components.schemas['Order']!['properties'] as Record<string, unknown>)['shipping']).toEqual({ 'x-flowatlas-unread': 'external-type' });
    expect(written.unread).toEqual({ 'any-typed': 1, 'external-type': 1, 'status-unread': 1, transformed: 1 });
  });

  it('writes the failures, one response per status, a helper\'s choices each under theirs (P87, P90)', () => {
    const create = doc.paths['/orders']!['post']!['responses'] as Record<string, Record<string, unknown>>;
    expect(create['400']).toEqual({ description: 'BadRequestException', 'x-flowatlas-sources': ['pipe'] });
    expect(create['500']).toEqual({ description: 'Error', 'x-flowatlas-assumed': true, 'x-flowatlas-sources': ['throw'] });
    expect(create['2XX']).toEqual({ description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } });
    const findOne = doc.paths['/orders/{id}']!['get']!['responses'] as Record<string, Record<string, unknown>>;
    expect(findOne['401']!['description']).toBe('UnauthorizedException (through toHttpError)');
    expect(findOne['403']!['description']).toBe('ForbiddenException (through toHttpError)');
    expect(findOne['default']).toMatchObject({ description: 'Error (status not read)', 'x-flowatlas-unread': 'status-unread' });
    expect(findOne['2XX']!['content']).toEqual({ 'application/json': { schema: { anyOf: [{ $ref: '#/components/schemas/Order' }, { type: 'null' }] } } });
  });

  it('says what stands in front, who calls it, where it was read and how surely (I4)', () => {
    const create = doc.paths['/orders']!['post']!;
    expect(create['x-flowatlas-guards']).toEqual([{ name: 'AuthGuard', layer: 'guard', where: 'global', via: 'APP_GUARD in AuthModule' }]);
    expect(create['x-flowatlas-callers']).toEqual({ gateway: 1 });
    expect(create['x-flowatlas-source']).toBe('src/orders.controller.ts:12');
    expect(create['x-flowatlas-confidence']).toBe('static');
    expect(create['operationId']).toBe('OrdersController.create');
    const health = doc.paths['/health']!['get']!;
    expect(health).toMatchObject({ 'x-flowatlas-public': true, 'x-flowatlas-public-by': '@flowatlas-public load balancer probes', 'x-flowatlas-callers': {} });
    expect(health['responses']).toEqual({ '2XX': { description: 'Success, with no body' } });
  });

  it('marks a route public by the configuration too', () => {
    const configured = writeOpenapiDocument(lookup, 'orders', { publicRoutes: ['GET /orders'] })!;
    expect(configured.operations.find((operation) => operation.key === 'GET /orders')?.public).toBe('doctor.publicRoutes GET /orders');
  });

  it('writes one document per application', () => {
    expect(writeOpenapiDocuments(lookup, 'orders').map((spec) => spec.name)).toEqual(['orders', 'orders@admin']);
    expect(Object.keys(writeOpenapiDocument(lookup, 'orders', { application: 'admin' })!.document['paths'] as object)).toEqual(['/stats']);
  });

  it('writes the cut past --depth as unread rather than a shape', () => {
    const shallow = writeOpenapiDocument(lookup, 'orders', { depth: 1 })!;
    const order = (shallow.document['components'] as { schemas: Record<string, Record<string, Record<string, unknown>>> }).schemas['Order']!;
    expect(order['properties']!['category']).toEqual({ 'x-flowatlas-unread': 'too-deep' });
    expect(shallow.unread['too-deep']).toBeGreaterThan(0);
  });

  it('reads back through the reader into the routes it was written from (D3)', () => {
    expect(verifyWritten(written)).toEqual([]);
    const read = readOpenapiDocument(written.document, { service: 'orders', documentPath: 'orders.openapi.yaml' });
    const create = read.graph.edges.find((edge) => edge.from === 'entry:orders:http:POST:/orders');
    // `2XX` is read as the success answer it is.
    expect(create?.returns).toBe('type:orders#Order');
    expect(verifyWritten({ ...written, operations: [...written.operations, { ...written.operations[0]!, route: 'DELETE:/nowhere' }] })).toEqual([
      'orders.openapi: DELETE:/nowhere was written and does not read back',
    ]);
  });

  it('writes the same bytes twice', () => {
    expect(JSON.stringify(writeOpenapiDocument(lookupOf(specGraph()), 'orders')!.document)).toBe(JSON.stringify(writeOpenapiDocument(lookup, 'orders')!.document));
  });

  it('writes nothing for a service with no route', () => {
    expect(writeOpenapiDocuments(lookup, 'billing')).toEqual([]);
  });
});

describe('routeInventory (P118)', () => {
  it('lists every route with who may call it, who does and what it fails with', () => {
    const rows = routeInventory(lookup, ['orders']);
    expect(rows.map((row) => `${row.verb} ${row.path}`)).toEqual([
      'ALL /files/*',
      'GET /health',
      'GET /orders',
      'POST /orders',
      'GET /orders/:param',
      'GET /reports/${…}',
      'GET /stats',
    ]);
    const create = rows.find((row) => row.verb === 'POST')!;
    expect(create).toMatchObject({ guarded: true, callers: { gateway: 1 }, fails: ['400', '500?'] });
    expect(rows.find((row) => row.path === '/health')).toMatchObject({ guarded: false, public: '@flowatlas-public load balancer probes' });
    expect(rows.find((row) => row.path === '/orders/:param')?.fails).toEqual(['401', '403', '?']);
    expect(rows.find((row) => row.path === '/stats')?.application).toBe('admin');
  });
});
