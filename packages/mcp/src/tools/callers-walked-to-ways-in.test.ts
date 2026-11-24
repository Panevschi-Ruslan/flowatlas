import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';

/**
 * who_calls answers "who calls this, up to the ways in" in one call (P376),
 * against a back end whose stock class has four methods sharing callers: two
 * checkout routes, a nightly job, and a daily report that reads the level
 * four calls down, each route also requested by a screen.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'callers-walked-to-ways-in', 'flowatlas.config.json');
const STOCK = 'stock-api#src/stock/stock.service.ts:StockService';
const LEVEL = `${STOCK}.level`;

const PLACE = 'entry:stock-api:http:POST:/checkout';
const CANCEL = 'entry:stock-api:http:DELETE:/checkout/:param';
const REPORT = 'entry:stock-api:http:GET:/reports/daily';
const NIGHTLY = 'entry:stock-api:cron:StockJobs.nightly';
const CHECKOUT_SCREEN = 'entry:store-web:screen:/checkout';
const REPORT_SCREEN = 'entry:store-web:screen:/reports';

let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}, verbose = true): Promise<any> => {
  const response = (await client.callTool({ name, arguments: { ...(verbose ? { verbose: true } : {}), ...args } })) as { content: Array<{ text: string }> };
  return JSON.parse(response.content[0]!.text);
};

/** Every row of a who_calls tree, by id. */
const treeIds = (rows: Array<{ node: { id: string }; children: any[] }>): string[] => rows.flatMap((row) => [row.node.id, ...treeIds(row.children)]);

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

describe('who_calls walks to the ways in when no depth is asked', () => {
  it('draws the nearest callers and lists every way in once, nearest first, however far', async () => {
    const answer = await call('who_calls', { symbol: LEVEL });
    // Two hops drawn: the four callers and what calls them.
    expect(answer.callers.map((row: { node: { id: string } }) => row.node.id).sort()).toEqual([
      'stock-api#src/checkout/checkout.service.ts:CheckoutService.cancel',
      'stock-api#src/checkout/checkout.service.ts:CheckoutService.place',
      'stock-api#src/reports/report.builder.ts:ReportBuilder.row',
      'stock-api#src/stock/stock.jobs.ts:StockJobs.nightly',
    ]);
    expect(treeIds(answer.callers)).not.toContain(REPORT);
    expect(answer.waysIn.map((row: { id: string }) => row.id)).toEqual([NIGHTLY, CANCEL, PLACE, REPORT, CHECKOUT_SCREEN, REPORT_SCREEN]);
    const report = answer.waysIn.find((row: { id: string }) => row.id === REPORT);
    expect(report).toMatchObject({ hops: 6, by: 'stock-api#src/reports/reports.controller.ts:ReportsController.daily' });
    expect(answer.complete).toBe(true);
    expect(answer.truncated).toBeUndefined();
    expect(answer.frontier).toBeUndefined();
    // Never the same call again, deeper: the answer reached the ways in.
    expect(answer.next.some((hint: string) => hint.startsWith('who_calls('))).toBe(false);
  });

  it('keeps the ways in in the compact answer, and with a depth of 3 too, where that took three calls', async () => {
    const compact = await call('who_calls', { symbol: LEVEL }, false);
    expect(compact.waysIn.map((row: { id: string }) => row.id)).toEqual([NIGHTLY, CANCEL, PLACE, REPORT, CHECKOUT_SCREEN, REPORT_SCREEN]);
    // The depth is how far the tree is drawn, never a cut: the ways in past it are listed all the same (P379).
    const drawn = await call('who_calls', { symbol: LEVEL, depth: 3 }, false);
    expect(drawn.waysIn).toEqual(compact.waysIn);
    expect(drawn.complete).toBe(true);
    expect(drawn.left).toBeUndefined();
    expect((drawn.next ?? []).some((hint: string) => hint.startsWith('who_calls('))).toBe(false);
  });

  it('on a class, draws each method its direct callers and says each way in once with the methods it reaches', async () => {
    const answer = await call('who_calls', { symbol: STOCK });
    expect(answer.callers.every((row: { children: unknown[] }) => row.children.length === 0)).toBe(true);
    expect(answer.callers.map((row: { calls: string }) => row.calls)).toEqual(expect.arrayContaining(['level', 'release', 'reserve', 'restock']));
    expect(answer.waysIn.map((row: { id: string; reaches?: string[] }) => [row.id, row.reaches])).toEqual([
      [NIGHTLY, ['level', 'restock']],
      [CANCEL, ['level', 'release']],
      [PLACE, ['level', 'reserve']],
      [REPORT, ['level']],
      [CHECKOUT_SCREEN, ['level', 'release', 'reserve']],
      [REPORT_SCREEN, ['level']],
    ]);
    expect(answer.complete).toBe(true);
  });

  it('asked several symbols, says the ways in once for all, and which of them each reaches where not all', async () => {
    const answer = await call('who_calls', { symbols: [`${STOCK}.reserve`, `${STOCK}.restock`] });
    expect(answer.answers.map((one: { asked: string; callers: Array<{ node: { id: string } }> }) => [one.asked, one.callers.map((row) => row.node.id)])).toEqual([
      [`${STOCK}.reserve`, ['stock-api#src/checkout/checkout.service.ts:CheckoutService.place']],
      [`${STOCK}.restock`, ['stock-api#src/stock/stock.jobs.ts:StockJobs.nightly']],
    ]);
    expect(answer.answers.every((one: { waysIn?: unknown; complete?: boolean }) => one.waysIn === undefined && one.complete === undefined)).toBe(true);
    expect(answer.waysIn.map((row: { id: string; reaches?: string[] }) => [row.id, row.reaches])).toEqual([
      [NIGHTLY, ['StockService.restock']],
      [PLACE, ['StockService.reserve']],
      [CHECKOUT_SCREEN, ['StockService.reserve']],
    ]);
    expect(answer.complete).toBe(true);
  });

  it('with depth, draws the tree to that depth and still lists every way in (P379)', async () => {
    const answer = await call('who_calls', { symbol: LEVEL, depth: 6 });
    expect(treeIds(answer.callers)).toContain(REPORT);
    expect(answer.waysIn.map((row: { id: string }) => row.id)).toEqual([NIGHTLY, CANCEL, PLACE, REPORT, CHECKOUT_SCREEN, REPORT_SCREEN]);
    expect(answer.complete).toBe(true);
    expect(answer.truncated).toBeUndefined();
    expect(answer.frontier).toBeUndefined();
  });
});

/**
 * A controller's routes asked together (P379): five products routes, four
 * requested by two screens' client, the create's body typed inline with
 * 22 fields, the delete requested by nothing.
 */
describe("a controller's routes asked together stay small and finish (P379)", () => {
  const ROUTES = [
    'entry:stock-api:http:GET:/products',
    'entry:stock-api:http:GET:/products/:param',
    'entry:stock-api:http:POST:/products',
    'entry:stock-api:http:PUT:/products/:param',
    'entry:stock-api:http:DELETE:/products/:param',
  ];
  const CATALOG = 'entry:store-web:screen:/catalog';
  const EDIT = 'entry:store-web:screen:/catalog/:param';

  it('says the ways in once with what each reaches, complete, with a depth or without, never who_calls again', async () => {
    for (const depth of [undefined, 1]) {
      const answer = await call('who_calls', { symbols: ROUTES, ...(depth === undefined ? {} : { depth }) }, false);
      expect(answer.waysIn.map((row: { id: string; reaches: string[] }) => [row.id, row.reaches])).toEqual([
        [CATALOG, ['GET /products', 'POST /products']],
        [EDIT, ['GET /products/:param', 'PUT /products/:param']],
      ]);
      expect(answer.complete).toBe(true);
      expect(answer.left).toBeUndefined();
      expect(answer.answers.every((one: { complete?: boolean; left?: unknown }) => one.complete === undefined && one.left === undefined)).toBe(true);
      expect((answer.next ?? []).some((hint: string) => hint.startsWith('who_calls('))).toBe(false);
      // A screen's row names its component, not its routing table's line.
      expect(answer.waysIn[0]).toEqual({ id: CATALOG, reach: 'outside', hops: 5, by: 'store-web#src/app/catalog.component.ts:CatalogComponent', reaches: ['GET /products', 'POST /products'] });
    }
  });

  it("says the create's body by its size on the request's edge, and the note names verbose for it whole", async () => {
    const answer = await call('who_calls', { symbols: ROUTES }, false);
    const create = answer.answers.find((one: { asked: string }) => one.asked === 'entry:stock-api:http:POST:/products');
    expect(create.callers[0].edge).toEqual({ type: 'hits', params: ['{…22 fields}'], returns: 'string' });
    expect(answer.note).toContain('verbose: true');
    const whole = await call('who_calls', { symbols: ROUTES });
    const verbose = whole.answers.find((one: { asked: string }) => one.asked === 'entry:stock-api:http:POST:/products');
    expect(verbose.callers[0].edge.params[0]).toMatch(/^\{sku:string;name:string;.*maxOrder\?:number\}$/);
  });

  it("shortens the same types in get_flow's tree at detail 2: the signature's and the request's body", async () => {
    const compact = await call('get_flow', { entry: 'CatalogComponent.add', detail: 2 }, false);
    const text = JSON.stringify(compact);
    expect(text).not.toContain('maxOrder');
    expect(compact.root.children[0].meta.signature.params[0].type).toBe('{…22 fields}');
    const verbose = await call('get_flow', { entry: 'CatalogComponent.add', detail: 2 });
    expect(JSON.stringify(verbose)).toContain('maxOrder?:number');
    expect(text.length).toBeLessThan(JSON.stringify(verbose).length / 2);
  });

  it('lists the routes a controller declares with who calls each, and names dead for the verdicts', async () => {
    const answer = await call('list_entries', { in: 'ProductsController' }, false);
    expect(answer.entries.map((row: { id: string; reach: string; callers?: number; caller?: string }) => [row.id, row.reach, row.callers, row.caller])).toEqual([
      ['entry:stock-api:http:DELETE:/products/:param', 'dead', undefined, undefined],
      ['entry:stock-api:http:GET:/products', 'alive', 1, 'ui_api_call:store-web#src/app/products.client.ts:16:12'],
      ['entry:stock-api:http:GET:/products/:param', 'alive', 1, 'ui_api_call:store-web#src/app/products.client.ts:20:12'],
      ['entry:stock-api:http:POST:/products', 'alive', 1, 'ui_api_call:store-web#src/app/products.client.ts:47:12'],
      ['entry:stock-api:http:PUT:/products/:param', 'alive', 1, 'ui_api_call:store-web#src/app/products.client.ts:51:12'],
    ]);
    expect(answer.next[0]).toBe('dead({id: "stock-api#src/products/products.controller.ts:ProductsController"})');
  });
});
