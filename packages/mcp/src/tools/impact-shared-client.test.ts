import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';

/**
 * Impact lists only the ways in that call the changed code (P371), against a
 * back end whose two methods are each served by one route; a web front end
 * whose clients are injected by screens that call other methods of them, and
 * whose screens subscribe to a stream of the shop's events and call those
 * methods when a message arrives; a second front end; a bot; and a catch-all.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'impact-shared-client', 'flowatlas.config.json');
const ITEMS = 'market-api#src/items.service.ts:ItemsService.listByShop';
const DESKS = 'market-api#src/desks.service.ts:DesksService.ackCall';
const CONNECT = 'market-web#src/app/shop-events.service.ts:ShopEventsService.connect';
const HISTORY_CLIENT = 'market-web#src/app/items.client.ts:ItemsClient.getHistory';
const STAFF_CLIENT = 'market-web#src/app/staff-board.service.ts:StaffBoardService.ackCall';

let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
  const response = (await client.callTool({ name, arguments: { verbose: true, ...args } })) as { content: Array<{ text: string }> };
  return JSON.parse(response.content[0]!.text);
};

const rowsOf = (answer: { entries: Array<{ id: string; reach?: string; via?: string }> }): string[][] =>
  answer.entries.map((row) => [row.id, row.reach ?? '', row.via ?? '']);

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

describe('impact lists the ways in that call the code, and no other', () => {
  it('a route some screens request and others publish to the stream of: only the requesting screens, the bot command and the route', async () => {
    const answer = await call('impact', { symbol: ITEMS });
    expect(rowsOf(answer)).toEqual([
      ['entry:kiosk-web:screen:/browse', 'outside', 'GET /api/items (market-api)'],
      ['entry:market-api:http:GET:/api/items', 'alive', ''],
      ['entry:market-bot:bot_command:items', 'outside', 'GET /api/items (market-api)'],
      ['entry:market-web:screen:/history', 'outside', 'GET /api/items (market-api)'],
    ]);
    expect(answer.complete).toBe(true);
    expect(answer.maybe).toBeUndefined();
    expect(answer.channels).toEqual([]);
  });

  it('a method a screen reaches through its subscription: the screen alone, never the publishers of the channel or the screens behind them', async () => {
    const answer = await call('impact', { symbol: DESKS });
    expect(rowsOf(answer)).toEqual([
      ['entry:market-api:http:POST:/api/staff/desks/:param/ack-call', 'alive', ''],
      ['entry:market-web:screen:/staff', 'outside', 'POST /api/staff/desks/:param/ack-call (market-api)'],
    ]);
    expect(answer.complete).toBe(true);
  });

  it('a client method its consumer hands messages to and screens call: those screens, not every screen injecting its class', async () => {
    const answer = await call('impact', { symbol: CONNECT });
    expect(answer.entries.map((row: { id: string }) => row.id)).toEqual(['entry:market-web:screen:/history', 'entry:market-web:screen:/staff']);
  });

  it('a request a catch-all answers reaches the catch-all alone, and one a specific route answers never reaches it', async () => {
    const answer = await call('impact', { symbol: 'entry:market-api:http:ALL:/api/*' });
    expect(answer.entries.map((row: { id: string }) => row.id)).toEqual(['entry:kiosk-web:screen:/order', 'entry:market-web:screen:/reports']);
  });
});

describe('a row counts the ways in that reach it, its channel left uncrossed where a screen holds its subscription', () => {
  it('says one way in for each front-end client method', async () => {
    const answer = await call('find_symbol', { queries: ['ItemsClient.getHistory', 'StaffBoardService.ackCall'] });
    const rows = answer.answers.flatMap((each: { matches: Array<Record<string, unknown>> }) => each.matches);
    expect(rows.map((row: Record<string, unknown>) => [row.id, row.reach, row.from, row.ways])).toEqual([
      [HISTORY_CLIENT, 'alive', 'screen /history', undefined],
      [STAFF_CLIENT, 'alive', 'screen /staff', undefined],
    ]);
  });

  it('counts the screens that open the stream where there are several', async () => {
    const answer = await call('find_symbol', { query: 'ShopEventsService.connect' });
    const row = answer.matches.find((match: { id: string }) => match.id === CONNECT);
    expect(row).toMatchObject({ reach: 'alive', from: 'screen /history', ways: 2 });
  });

  it('a bot command registered in place is reached from the command, not from the method holding the registration', async () => {
    const answer = await call('impact', { symbol: 'market-bot#src/app.service.ts:AppService.getActive' });
    expect(rowsOf(answer)).toEqual([['entry:market-bot:bot_command:items', 'outside', '']]);
    expect(answer.complete).toBe(true);
    const row = await call('find_symbol', { query: 'MarketBot.showItems' });
    expect(row.matches[0]).toMatchObject({ reach: 'alive', from: 'bot_command items' });
    expect(row.matches[0].ways).toBeUndefined();
  });
});
