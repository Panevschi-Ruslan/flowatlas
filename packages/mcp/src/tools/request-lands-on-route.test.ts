import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serviceNamed } from '../query/service-name.js';
import { createFlowatlasServer } from '../server.js';
import { pathQueryOf } from './search.js';

/**
 * "Where does this request land" in one call (P377), against a web front end
 * whose clients extend a base that builds `${apiUrl}/admin/${store}/<resource>/<path>`
 * and a back end serving every route under a global `/api`; the configuration
 * names the services otherwise than their repositories' folders.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'request-lands-on-route', 'flowatlas.config.json');

const EXPORT = 'shop-admin#src/app/catalog.service.ts:CatalogService.exportSheet';
const AMEND = 'shop-admin#src/app/desk-order.service.ts:DeskOrderService.amendOrder';
const GROUPED_ROUTE = 'entry:shop-api:http:GET:/api/admin/:param/catalog/grouped';
const MODIFY_ROUTE = 'entry:shop-api:http:POST:/api/admin/:param/orders/:param/modify';
const GROUPED_BY = 'shop-api#src/catalog/admin-catalog.controller.ts:AdminCatalogController.grouped';
const MODIFY_BY = 'shop-api#src/orders/admin-orders.controller.ts:AdminOrdersController.modify';

let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}, verbose = false): Promise<any> => {
  const response = (await client.callTool({ name, arguments: { ...(verbose ? { verbose: true } : {}), ...args } })) as { content: Array<{ text: string }> };
  return JSON.parse(response.content[0]!.text);
};

beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createFlowatlasServer({ configPath: CONFIG, allTools: true });
  await server.connect(serverSide);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
});

describe('get_flow takes any symbol', () => {
  it('walks a method named by Class.method across the request to the handler', async () => {
    const answer = await call('get_flow', { entry: 'DeskOrderService.amendOrder' });
    expect(answer.root.id).toBe(AMEND);
    expect(JSON.stringify(answer.root)).toContain(MODIFY_BY);
  });

  it('answers the candidates, each as the call to make, for a name two services share', async () => {
    const answer = await call('get_flow', { entry: 'CatalogService' });
    expect(answer.candidates).toHaveLength(2);
    expect(answer.next).toEqual(answer.candidates.map((row: { id: string }) => `get_flow({entry: ${JSON.stringify(row.id)}})`));
  });

  it('names find_symbol, never an empty list of suggestions, when nothing matches', async () => {
    const answer = await call('get_flow', { entry: 'zzqqxx' });
    expect(answer.error).toBe('nothing matches "zzqqxx"');
    expect(answer.suggestions).toBeUndefined();
    expect(answer.next).toEqual(['find_symbol({query: "zzqqxx"})']);
  });
});

describe('an answer about a method says where its requests land', () => {
  it('who_calls: the route and the handler on the target', async () => {
    const answer = await call('who_calls', { symbol: 'CatalogService.getGrouped' });
    expect(answer.target.requests).toEqual([{ route: GROUPED_ROUTE, by: GROUPED_BY }]);
  });

  it('find_symbol: on the match that sends one, not on the screen calling it', async () => {
    const answer = await call('find_symbol', { query: 'amend' });
    const amend = answer.matches.find((row: { id: string }) => row.id === AMEND);
    expect(amend.requests).toEqual([{ route: MODIFY_ROUTE, by: MODIFY_BY }]);
    const screen = answer.matches.find((row: { id: string }) => row.id.endsWith('DeskComponent.amend'));
    expect(screen?.requests).toBeUndefined();
  });

  it('get_source: the address as written where it is joined to no route', async () => {
    // The document, asked verbose: compact, get_source answers the code as plain text (P382).
    const answer = await call('get_source', { symbol: EXPORT }, true);
    expect(answer.requests).toBeUndefined();
    expect(answer.requestsUnjoined).toEqual(['POST ${apiUrl}/admin/:param/catalog/export']);
  });

  it('says nothing on code that sends nothing', async () => {
    const answer = await call('who_calls', { symbol: MODIFY_BY });
    expect(answer.target.requests).toBeUndefined();
    expect(answer.target.requestsUnjoined).toBeUndefined();
  });
});

describe('search finds a route by the path a client writes', () => {
  it('whatever the parameter is called, and without the global prefix', async () => {
    for (const query of ['orders/:orderId/modify', '/admin/:rid/orders/${id}/modify', 'admin/{store}/orders/<id>/modify', 'POST /admin/:s/orders/:o/modify']) {
      const answer = await call('search', { query, kinds: ['routes'] });
      expect(answer.results?.routes?.map((row: { id: string }) => row.id), query).toEqual([MODIFY_ROUTE]);
    }
  });

  it('not under another verb, which finds it by its words only, never complete (P383)', async () => {
    const answer = await call('search', { query: 'GET /admin/:s/orders/:o/modify', kinds: ['routes'] });
    expect(answer.results).toBeUndefined();
    expect(answer.best?.map((row: { id: string }) => row.id)).toEqual([MODIFY_ROUTE]);
    expect(answer.best?.[0]?.matched).toEqual(['admin', 'orders', 'modify']);
    expect(answer.complete).toBe(false);
    expect(answer.left?.[0]).toMatch(/^fuzzy: ranked by the words get, admin, orders, modify/);
  });

  it('reads a path query into segments with every hole a parameter', () => {
    expect(pathQueryOf('https://shop.example.test/admin/${store}/orders/{id}?x=1')).toEqual({ segments: ['admin', ':param', 'orders', ':param'] });
    expect(pathQueryOf('post /a/:b')).toEqual({ method: 'POST', segments: ['a', ':param'] });
    expect(pathQueryOf('modify')).toBeUndefined();
  });
});

describe('a service named by its repository folder', () => {
  it('is the service the configuration names', async () => {
    const answer = await call('search', { query: 'modify', kinds: ['routes'], service: 'shop-backend' });
    expect(answer.results.routes.map((row: { id: string }) => row.id)).toEqual([MODIFY_ROUTE]);
    const entries = await call('list_entries', { service: './shop-frontend' });
    expect(entries.entries.map((row: { id: string }) => row.id)).toEqual(['entry:shop-admin:screen:/catalog', 'entry:shop-admin:screen:/desk']);
  });

  it('answers the services there are for a name that is none', async () => {
    const answer = await call('search', { query: 'modify', service: 'backend' });
    expect(answer).toEqual({ error: 'no service named "backend"', services: ['shop-admin', 'shop-api'] });
  });

  it('is read by name, folder and case, and refuses to pick between two folders alike', () => {
    const services = [
      { name: 'orders', repo: './apps/orders-svc', type: 'nestjs', extractor: null },
      { name: 'web', repo: './web/', type: 'angular', extractor: null },
      { name: 'web-next', repo: './next/web', type: 'react', extractor: null },
    ];
    expect(serviceNamed(services, 'orders')).toEqual({ service: 'orders' });
    expect(serviceNamed(services, 'orders-svc')).toEqual({ service: 'orders' });
    expect(serviceNamed(services, 'apps/orders-svc')).toEqual({ service: 'orders' });
    expect(serviceNamed(services, 'ORDERS')).toEqual({ service: 'orders' });
    expect(serviceNamed(services, 'web')).toEqual({ service: 'web' });
    expect(serviceNamed([services[1]!, { ...services[2]!, name: 'other' }], 'web')).toEqual({ service: 'web' });
    expect(serviceNamed([{ ...services[1]!, name: 'b' }, { ...services[2]!, name: 'a' }], 'web')).toMatchObject({ services: ['a', 'b'] });
    expect(serviceNamed([], 'anything')).toEqual({ service: 'anything' });
  });
});
