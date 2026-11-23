import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';

/**
 * What a pilot on a real project paid for after P374 (P375): impact asked at
 * detail 2 handed every row the way in's whole `meta`, every exception any
 * code under it can throw among them; a question about the four routes of
 * one controller was answered by listing every route under a path; and a
 * route's `by` was taken for a way in of its own. Against the
 * `rows-name-handling-code` fixture, whose cancel method refuses four ways
 * behind two guards, and whose reports controller declares four routes the
 * reports screen requests two of.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'rows-name-handling-code', 'flowatlas.config.json');
const CANCEL = 'shop-api#src/orders/orders.service.ts:OrdersService.cancel';
const ROUTE = 'entry:shop-api:http:PATCH:/api/orders/:param/cancel';
const UNCALLED = ['entry:shop-api:http:DELETE:/api/reports/:param', 'entry:shop-api:http:GET:/api/reports/weekly'];
const CALLED = ['entry:shop-api:http:GET:/api/reports/daily', 'entry:shop-api:http:POST:/api/reports/export'];

let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
  const response = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }> };
  return JSON.parse(response.content[0]!.text);
};

const ids = (rows: Array<{ id: string }>): string[] => rows.map((row) => row.id);

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

describe('a list answer stays lean at any detail', () => {
  it("leaves the rows' failures and guards out at detail 2, keeps the target's, and says so once", async () => {
    const answer = await call('impact', { symbol: CANCEL, detail: 2 });
    for (const row of answer.entries) {
      expect(row.meta?.fails).toBeUndefined();
      expect(row.meta?.access).toBeUndefined();
    }
    // The plain facts that help choose among the rows stay.
    expect(answer.entries.find((row: { id: string }) => row.id === ROUTE).meta).toMatchObject({ controller: 'OrdersController' });
    expect(answer.target.meta.signature).toBeDefined();
    expect(answer.note).toContain('(access, fails)');
    expect(answer.note).toContain('verbose: true');
  });

  it('hands every row its whole meta when asked verbose', async () => {
    const answer = await call('impact', { symbol: CANCEL, detail: 2, verbose: true });
    const route = answer.entries.find((row: { id: string }) => row.id === ROUTE);
    expect(route.meta.fails.map((fail: { status: number }) => fail.status)).toEqual([400, 403, 404, 409, 410, 503]);
    expect(route.meta.access.guards).toHaveLength(2);
    expect(answer.note).toBeUndefined();
  });

  it('says nothing at detail 1, where no row carries meta', async () => {
    const answer = await call('impact', { symbol: CANCEL });
    expect(answer.note).toBeUndefined();
  });
});

describe('impact says which rows reach the target through another', () => {
  it('the route the screen requests counts the rows reaching through it, the screen names it in via', async () => {
    const answer = await call('impact', { symbol: CANCEL });
    const byId = new Map(answer.entries.map((row: { id: string }) => [row.id, row]));
    expect(byId.get(ROUTE)).toMatchObject({ rowsVia: 1, by: 'shop-api#src/orders/orders.controller.ts:OrdersController.cancel' });
    expect(byId.get('entry:shop-web:screen:/orders/:param')).toMatchObject({ via: 'PATCH /api/orders/:param/cancel (shop-api)' });
    expect(byId.get('entry:shop-api:http:POST:/bot/staff/webhook')).not.toHaveProperty('rowsVia');
  });
});

describe("a class's ways in in one small call", () => {
  it('dead on a controller judges each route it declares', async () => {
    const answer = await call('dead', { id: 'ReportsController' });
    expect(ids(answer.waysIn)).toEqual([...UNCALLED.slice(0, 1), CALLED[0], UNCALLED[1], CALLED[1]]);
    expect(answer.waysIn.filter((row: { verdict: string }) => row.verdict !== 'alive').map((row: { id: string }) => row.id)).toEqual(UNCALLED);
    expect(answer.waysIn.find((row: { id: string }) => row.id === CALLED[0]).caller).toContain('reports.client.ts');
    expect(answer).toMatchObject({ uncalled: 2, complete: true });
    expect(answer.next).toEqual([`get_source({symbol: "${UNCALLED[0]}"})`]);
  });

  it('dead on the file it is written in answers the same routes', async () => {
    const answer = await call('dead', { id: 'src/reports/reports.controller.ts' });
    expect(answer.file).toBe('src/reports/reports.controller.ts');
    expect(ids(answer.waysIn).sort()).toEqual([...CALLED, ...UNCALLED].sort());
    expect(answer.uncalled).toBe(2);
  });

  it('list_entries takes the class and a reach: exactly the two routes no code calls', async () => {
    const all = await call('list_entries', { in: 'ReportsController' });
    expect(all.declaredBy).toBe('shop-api#src/reports/reports.controller.ts:ReportsController');
    expect(all.entries.map((row: { id: string; reach: string }) => [row.id, row.reach]).sort()).toEqual(
      [...CALLED.map((id) => [id, 'alive']), ...UNCALLED.map((id) => [id, 'dead'])].sort(),
    );
    const dead = await call('list_entries', { in: 'ReportsController', reach: 'dead' });
    expect(ids(dead.entries)).toEqual(UNCALLED);
    expect(dead.complete).toBe(true);
    const byFile = await call('list_entries', { in: 'reports/reports.controller.ts', reach: 'dead' });
    expect(ids(byFile.entries)).toEqual(UNCALLED);
  });

  it('a method answers for the route it handles, and a name nothing has is said', async () => {
    const answer = await call('list_entries', { in: 'OrdersController.cancel' });
    expect(ids(answer.entries)).toEqual([ROUTE]);
    const none = await call('list_entries', { in: 'NoSuchControllerAnywhere' });
    expect(none.error ?? none.candidates).toBeDefined();
  });
});
