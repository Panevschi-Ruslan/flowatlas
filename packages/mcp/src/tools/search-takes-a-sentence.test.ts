import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';

/**
 * Search and find_symbol take a sentence (P383): each name's words are
 * indexed once, a query's words ranked by how many a name holds, then by
 * kind and reach, then BM25. An answer found this way is never complete.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'search-takes-a-sentence', 'flowatlas.config.json');

const CANCEL_ROUTE = 'entry:shop-api:http:POST:/orders/:param/cancel';
const REFUND_ROUTE = 'entry:shop-api:http:POST:/orders/:param/refund';
const PAYMENTS_ROUTE = 'entry:shop-api:http:POST:/payments';
const CLIENT_CANCEL = 'shop-web#src/app/orders.client.ts:OrdersClient.cancel';
const HANDLER_CANCEL = 'shop-api#src/orders/orders.controller.ts:OrdersController.cancel';
const CLIENT_PAY = 'shop-web#src/app/payments.client.ts:PaymentsClient.pay';
const DECOY = 'shop-api#src/common/cancellation-tokens.ts:CancellationTokens';

let client: Client;

const call = async (name: string, args: Record<string, unknown>): Promise<any> => {
  const response = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
  return { ...JSON.parse(response.content[0]!.text), isError: response.isError === true };
};

const ids = (rows: Array<{ id: string }> | undefined): string[] => (rows ?? []).map((row) => row.id);

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

describe('search takes a sentence', () => {
  it('finds where an order is cancelled: the route first, then the code holding both words, never complete', async () => {
    const answer = await call('search', { query: 'where is the order cancelled' });
    expect(answer.isError).toBe(false);
    expect(answer.results).toBeUndefined();
    expect(ids(answer.best)[0]).toBe(CANCEL_ROUTE);
    expect(ids(answer.best)).toEqual(expect.arrayContaining([HANDLER_CANCEL, CLIENT_CANCEL]));
    for (const row of answer.best) expect(row.matched).toEqual(['order', 'cancelled']);
    // The decoy holds one of the two words: left out, and counted.
    expect(ids(answer.best)).not.toContain(DECOY);
    expect(answer.complete).toBe(false);
    expect(answer.left[0]).toMatch(/^fuzzy: ranked by the words order, cancelled; \d+ hold fewer$/);
    expect(answer.next[0]).toContain(CANCEL_ROUTE);
  });

  it('finds what handles payments, the way in first, and a word no name holds asked for still', async () => {
    const answer = await call('search', { query: 'what handles payments' });
    expect(ids(answer.best)[0]).toBe(PAYMENTS_ROUTE);
    expect(ids(answer.best)).toContain(CLIENT_PAY);
    expect(answer.left[0]).toBe('fuzzy: ranked by the words handles, payments');
  });

  it('takes OR and ranks a way in that runs before one that does not', async () => {
    const answer = await call('search', { query: 'cancel OR refund' });
    expect(ids(answer.best).slice(0, 2)).toEqual([CANCEL_ROUTE, REFUND_ROUTE]);
    expect(answer.best[1].reach).toBe('dead');
    expect(answer.best.length).toBe(10);
    expect(answer.left[0]).toMatch(/more rows hold as many/);
  });

  it('narrows by kind, and finds nothing where no name holds a word', async () => {
    const routes = await call('search', { query: 'order cancel', kinds: ['routes'] });
    expect(ids(routes.best)).toEqual([CANCEL_ROUTE]);
    const none = await call('search', { query: 'zebra quokka' });
    expect(none.isError).toBe(true);
    expect(none.error).toBe('nothing matches "zebra quokka"');
  });

  it('keeps a name found as written as it was, with no words beside it', async () => {
    const answer = await call('search', { query: 'PaymentsClient' });
    expect(answer.best).toBeUndefined();
    expect(answer.complete).toBe(true);
  });
});

describe('find_symbol by words', () => {
  it('finds "order cancel" and cancelOrder, which no name holds as written', async () => {
    for (const query of ['order cancel', 'cancelOrder']) {
      const answer = await call('find_symbol', { query });
      expect(ids(answer.matches)[0], query).toBe(CANCEL_ROUTE);
      expect(ids(answer.matches), query).toEqual(expect.arrayContaining([CLIENT_CANCEL, HANDLER_CANCEL]));
      expect(answer.complete, query).toBe(false);
      expect(answer.left[0], query).toMatch(/^fuzzy: /);
      // A client method still says where its request lands (P377).
      expect(answer.matches.find((row: { id: string }) => row.id === CLIENT_CANCEL).requests).toEqual([{ route: CANCEL_ROUTE, by: HANDLER_CANCEL }]);
    }
  });

  it('keeps types and service, and pages ten at a time', async () => {
    const methods = await call('find_symbol', { query: 'order cancel', types: ['method'], service: 'shop-web' });
    expect(ids(methods.matches)).toEqual([CLIENT_CANCEL, 'shop-web#src/app/orders.component.ts:OrdersComponent.cancelOne']);
    const nothing = await call('find_symbol', { query: 'zebra quokka' });
    expect(nothing).toMatchObject({ matches: [], total: 0, complete: true });
  });
});
