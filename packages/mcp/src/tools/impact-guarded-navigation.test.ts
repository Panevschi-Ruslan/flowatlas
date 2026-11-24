import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';

/**
 * Impact never walks back along a navigation, from a guard to the screens it
 * guards, or across a channel into its publishers (P372), against a back end
 * with a list method two screens and a bot call, a method a board screen, a
 * route and a webhook call, and four routes publishing on three channels the
 * bot re-fetches the list on (P378); a web front end whose login screen and role guard
 * navigate to the dashboard, whose ticket screens navigate to the board, and
 * whose screens a sign-in guard and a role guard redirect from.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'impact-guarded-navigation', 'flowatlas.config.json');
const ITEMS = 'store-api#src/items.service.ts:ItemsService.listByShop';
const TICKETS = 'store-api#src/tickets.service.ts:TicketsService.acknowledge';
const ROLE = 'store-web#src/app/auth.service.ts:AuthService.role';
const BOT = 'consumer:store-bot#src/store-bot.ts:StoreBot.onStatusEvent';
const CHANNELS = ['shop:*:closed', 'shop:*:orders', 'shop:*:paid'];
/** The ways in beyond any of the bot's three channels, each once. */
const BEYOND = [
  'entry:store-api:http:DELETE:/api/orders/:param',
  'entry:store-api:http:PATCH:/api/orders/:param/status',
  'entry:store-api:http:POST:/api/orders',
  'entry:store-api:http:POST:/api/orders/:param/pay',
  'entry:store-web:screen:/orders',
];

let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
  const response = (await client.callTool({ name, arguments: { verbose: true, ...args } })) as { content: Array<{ text: string }> };
  return JSON.parse(response.content[0]!.text);
};

const idsOf = (answer: { entries: Array<{ id: string }> }): string[] => answer.entries.map((row) => row.id);

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

describe('impact walks back along calls and requests, never a navigation or a guard', () => {
  it('a method one screen calls: that screen, the route and the webhook, never the screens that navigate to it', async () => {
    const answer = await call('impact', { symbol: TICKETS });
    expect(idsOf(answer)).toEqual([
      'entry:store-api:http:POST:/api/hooks/chat',
      'entry:store-api:http:POST:/api/tickets/:param/ack',
      'entry:store-web:screen:/board',
    ]);
    expect(answer.complete).toBe(true);
    expect(answer.throughChannels).toBeUndefined();
  });

  it('a list method: the route, the two screens and the bot, never what a login, a guard or a ticket screen navigates from', async () => {
    const answer = await call('impact', { symbol: ITEMS });
    expect(answer.entries.map((row: { id: string; via?: string }) => [row.id, row.via ?? ''])).toEqual([
      ['entry:store-api:http:GET:/api/shops/items', ''],
      ['entry:store-bot:bot_command:items', 'GET /api/shops/items (store-api)'],
      ['entry:store-bot:event:shop:*:closed', 'GET /api/shops/items (store-api)'],
      ['entry:store-bot:event:shop:*:orders', 'GET /api/shops/items (store-api)'],
      ['entry:store-bot:event:shop:*:paid', 'GET /api/shops/items (store-api)'],
      ['entry:store-web:screen:/dashboard', 'GET /api/shops/items (store-api)'],
      ['entry:store-web:screen:/history', 'GET /api/shops/items (store-api)'],
    ]);
    expect(answer.complete).toBe(true);
    expect(answer.left).toBeUndefined();
  });

  it('the code a guard runs: every screen the guard is listed on, and none it redirects to', async () => {
    const answer = await call('impact', { symbol: ROLE });
    expect(idsOf(answer)).toEqual([
      'entry:store-web:screen:/analytics',
      'entry:store-web:screen:/analytics/matrix',
      'entry:store-web:screen:/orders',
    ]);
  });
});

describe('what lies only beyond a channel is counted apart, and listed on asking', () => {
  it('counts the publishers of the channels the bot re-fetches on, and the screen calling them, once under throughChannels (P378)', async () => {
    const answer = await call('impact', { symbol: ITEMS });
    // One row for the bot's consumer, its three channels together, a route publishing on two counted once: it was
    // three rows, one per channel, each repeating the routes and the samples.
    expect(answer.throughChannels).toEqual([
      {
        consumer: BOT,
        channels: CHANNELS,
        ways: 5,
        // Each with the code that handles it (P374).
        sample: [
          { id: 'entry:store-api:http:DELETE:/api/orders/:param', by: 'store-api#src/orders.controller.ts:OrdersController.remove' },
          { id: 'entry:store-api:http:PATCH:/api/orders/:param/status', by: 'store-api#src/orders.controller.ts:OrdersController.setStatus' },
          { id: 'entry:store-api:http:POST:/api/orders', by: 'store-api#src/orders.controller.ts:OrdersController.create' },
        ],
      },
    ]);
    expect(answer.channels).toEqual(CHANNELS.map((channel) => `channel:${channel}`));
    // A consumer on several channels is listed by the consumer.
    expect(answer.next[0]).toBe(`impact({symbol: "${ITEMS}", channel: "${BOT}"})`);
  });

  it('lists the ways in beyond the channel when it is asked for, each through it', async () => {
    const answer = await call('impact', { symbol: ITEMS, channel: 'shop:*:orders' });
    expect(answer.acrossChannel).toBe('shop:*:orders');
    expect(answer.entries.map((row: { id: string; via?: string }) => [row.id, row.via ?? ''])).toEqual([
      ['entry:store-api:http:PATCH:/api/orders/:param/status', 'channel shop:*:orders'],
      ['entry:store-api:http:POST:/api/orders', 'channel shop:*:orders'],
      ['entry:store-api:http:POST:/api/orders/:param/pay', 'channel shop:*:orders'],
      ['entry:store-web:screen:/orders', 'channel shop:*:orders'],
    ]);
    expect(answer.throughChannels).toBeUndefined();
    expect(answer.complete).toBe(true);
  });

  it('lists the ways in beyond every channel of a consumer when the consumer is asked for, each once (P378)', async () => {
    for (const consumer of [BOT, 'StoreBot.onStatusEvent']) {
      const answer = await call('impact', { symbol: ITEMS, channel: consumer });
      expect(answer.acrossConsumer).toBe(BOT);
      expect(answer.acrossChannel).toBeUndefined();
      expect(idsOf(answer)).toEqual(BEYOND);
      expect(answer.entries.every((row: { via: string }) => CHANNELS.some((channel) => row.via === `channel ${channel}`))).toBe(true);
      expect(answer.complete).toBe(true);
    }
  });

  it('says so when the channel asked for is not on the way', async () => {
    const answer = await call('impact', { symbol: TICKETS, channel: 'shop:*:orders' });
    expect(answer.entries).toEqual([]);
    expect(answer.entriesNone).toContain('no way in lies beyond a channel shop:*:orders');
  });
});

describe('a row counts the ways in whose code reaches it', () => {
  it('says the screen that shows it and nothing that navigates there, and the bot event its handler is, not its channel’s publishers', async () => {
    const answer = await call('find_symbol', { queries: ['DashboardComponent.loadData', 'TicketBoardComponent.routeAction', 'StoreBot.onStatusEvent'] });
    const rows = answer.answers.map((one: { matches: Array<{ id: string; from?: string; ways?: number }> }) =>
      one.matches.map((row) => [row.id, row.from ?? '', row.ways ?? 1]),
    );
    expect(rows).toEqual([
      [['store-web#src/app/dashboard.component.ts:DashboardComponent.loadData', 'screen /dashboard', 1]],
      [['store-web#src/app/ticket-board.component.ts:TicketBoardComponent.routeAction', 'screen /board', 1]],
      [
        ['consumer:store-bot#src/store-bot.ts:StoreBot.onStatusEvent', 'event shop:*:closed', 3],
        ['store-bot#src/store-bot.ts:StoreBot.onStatusEvent', 'event shop:*:closed', 3],
      ],
    ]);
  });
});

describe('who_calls counts what lies past a channel (P378)', () => {
  it('says the bot once, its channels and how many ways in lie past them, no sample, and names the impact call listing them', async () => {
    const answer = await call('who_calls', { symbol: ITEMS });
    expect(answer.throughChannels).toEqual([{ consumer: BOT, channels: CHANNELS, ways: 5 }]);
    expect(answer.waysIn.map((row: { id: string }) => row.id)).not.toContain('entry:store-web:screen:/orders');
    expect(answer.complete).toBe(true);
    expect(answer.next).toContain(`impact({symbol: "${ITEMS}", channel: "${BOT}"})`);
  });

  it('the compact answer keeps the row whole', async () => {
    const response = (await client.callTool({ name: 'who_calls', arguments: { symbol: ITEMS } })) as { content: Array<{ text: string }> };
    const compact = JSON.parse(response.content[0]!.text);
    expect(compact.throughChannels).toEqual([{ consumer: BOT, channels: CHANNELS, ways: 5 }]);
  });
});
