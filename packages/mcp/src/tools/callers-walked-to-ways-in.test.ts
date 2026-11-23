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

  it('keeps the ways in in the compact answer, in one call where a depth of 3 took three', async () => {
    const compact = await call('who_calls', { symbol: LEVEL }, false);
    expect(compact.waysIn.map((row: { id: string }) => row.id)).toEqual([NIGHTLY, CANCEL, PLACE, REPORT, CHECKOUT_SCREEN, REPORT_SCREEN]);
    const cut = await call('who_calls', { symbol: LEVEL, depth: 3 }, false);
    expect(cut.complete).toBe(false);
    // A tree cut by depth names the call that walks to every way in, not a deeper depth.
    expect(cut.next[0]).toBe(`who_calls({symbol: ${JSON.stringify(LEVEL)}})`);
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

  it('with depth, answers the tree to that depth as before', async () => {
    const answer = await call('who_calls', { symbol: LEVEL, depth: 6 });
    expect(answer.waysIn).toBeUndefined();
    expect(treeIds(answer.callers)).toContain(REPORT);
  });
});
