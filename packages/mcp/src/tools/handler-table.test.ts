import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';

/**
 * A bot whose buttons, commands and text go through tables of handlers the
 * code writes out (P398): its handlers are called by the dispatcher, reached
 * from the bot's ways in, and nothing about them is maybe.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const TABLES = join(ROOT, 'fixtures', 'handler-table-dispatch', 'flowatlas.config.json');
const WEBHOOK = join(ROOT, 'fixtures', 'impact-bot-webhook', 'flowatlas.config.json');
const SHOW = 'staff-bot#src/staff-bot.ts:StaffBot.showOrder';
const LIST_ACTIVE = 'shop-api#src/orders.service.ts:OrdersService.listActive';

const connect = async (configPath: string): Promise<Client> => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer({ configPath, allTools: true }).connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  return client;
};

let tables: Client;
let webhook: Client;

const call = async (client: Client, name: string, args: Record<string, unknown>): Promise<any> => {
  const response = (await client.callTool({ name, arguments: { verbose: true, ...args } })) as { content: Array<{ text: string }> };
  return JSON.parse(response.content[0]!.text);
};

beforeAll(async () => {
  tables = await connect(TABLES);
  webhook = await connect(WEBHOOK);
});

afterAll(async () => {
  await tables.close();
  await webhook.close();
});

describe('a handler held by a table written out', () => {
  it('is reached from the way in its prefix opens (P399), never maybe', async () => {
    const answer = await call(tables, 'who_calls', { symbol: SHOW });
    const callers = (answer.callers as Array<{ node: { id: string; reach?: string } }>).map((item) => item.node);
    // The element's own handler, which the way in of its prefix names; the listener choosing it is not drawn again.
    expect(callers.map((node) => node.id)).toEqual(['staff-bot#src/staff-bot.ts:bot_callback view_order_*@28']);
    expect(callers.every((node) => node.reach === 'alive')).toBe(true);
    expect((answer.waysIn as Array<{ id: string }>).map((row) => row.id)).toEqual(['entry:staff-bot:bot_callback:view_order_*']);
    expect(answer.target.from).toBe('bot_callback view_order_*');
    expect(answer.complete).toBe(true);
  });

  it('says the framework reaches what only a lifecycle hook calls (P399)', async () => {
    const answer = await call(tables, 'dead', { ids: ['staff-bot#src/staff-bot.ts:StaffBot.setup', 'staff-bot#src/staff-bot.ts:StaffBot.onModuleInit'] });
    const rows = answer.answers as Array<{ verdict: string; from?: string }>;
    expect(rows.map((row) => row.verdict)).toEqual(['alive', 'alive']);
    expect(rows.map((row) => row.from)).toEqual(['startup (onModuleInit)', 'startup (onModuleInit)']);
    // A call written in the text listener is the listener's, not again the method that registers it.
    const route = await call(tables, 'impact', { symbol: 'staff-bot#src/text-router.ts:TextRouter.route' });
    expect((route.entries as Array<{ id: string }>).map((row) => row.id)).toEqual(['entry:staff-bot:bot_event:text']);
    expect(route.maybe ?? 0).toBe(0);
  });

  it('follows tables in a React screen and a plain script (P399)', async () => {
    const screen = await call(tables, 'who_calls', { symbol: 'shop-web#src/orders-api.ts:markReady', depth: 1 });
    expect(screen.callers.map((item: { node: { id: string }; edge?: { meta?: Record<string, string> } }) => item.node.id)).toEqual(['shop-web#src/OrdersToolbar.tsx:OrdersToolbar']);
    const kiosk = await call(tables, 'who_calls', { symbol: 'kiosk#js/kiosk.js:showStock', depth: 1 });
    expect(kiosk.callers.map((item: { node: { id: string } }) => item.node.id)).toEqual(['kiosk#js/kiosk.js:openScreen']);
  });

  it('counts the bot under bots in impact on the API method behind it, with no maybe row', async () => {
    const answer = await call(tables, 'impact', { symbol: LIST_ACTIVE });
    const ids = (answer.entries as Array<{ id: string }>).map((row) => row.id);
    expect(ids).toEqual(expect.arrayContaining(['entry:shop-api:http:GET:/api/orders/active', 'entry:staff-bot:bot_callback:view_order_*', 'entry:staff-bot:bot_command:orders']));
    expect(ids).not.toContain('entry:staff-bot:bot_event:callback_query');
    expect(answer.maybe ?? 0).toBe(0);
    expect(answer.byKind.bots).toEqual({ 'staff-bot': ['src/staff-bot.ts'] });
  });

  it('says alive on the handlers a button, a command and a text command run', async () => {
    const answer = await call(tables, 'dead', { ids: [SHOW, 'staff-bot#src/staff-bot.ts:StaffBot.listOrders', 'staff-bot#src/replies.ts:replyStock'] });
    expect((answer.answers as Array<{ verdict: string }>).map((row) => row.verdict)).toEqual(['alive', 'alive', 'alive']);
  });

  it('opens one way in per element a loop over a table registers, so the courier bot is a bot and no maybe', async () => {
    const answer = await call(webhook, 'impact', { symbol: 'shop-api#src/orders.service.ts:OrdersService.updateStatus' });
    expect((answer.entries as Array<{ id: string }>).map((row) => row.id)).toContain('entry:courier-bot:bot_callback:/^delivered:(\\w+)$/');
    expect(answer.maybe ?? 0).toBe(0);
    expect(answer.byKind.bots['courier-bot']).toEqual(['src/courier-bot.ts']);
  });
});
