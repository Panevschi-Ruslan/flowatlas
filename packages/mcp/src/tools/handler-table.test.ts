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
  it('is called by the dispatcher, reached from the bot, never maybe', async () => {
    const answer = await call(tables, 'who_calls', { symbol: SHOW });
    const callers = (answer.callers as Array<{ node: { id: string; reach?: string } }>).map((item) => item.node);
    // The handler the way in names dispatches; the method it is written in is not drawn again (nothing but the framework calls it).
    expect(callers.map((node) => node.id)).toEqual(['staff-bot#src/staff-bot.ts:on callback_query@43']);
    expect(callers.every((node) => node.reach === 'alive')).toBe(true);
    expect((answer.waysIn as Array<{ id: string }>).map((row) => row.id)).toEqual(['entry:staff-bot:bot_event:callback_query']);
    expect(answer.complete).toBe(true);
  });

  it('counts the bot under bots in impact on the API method behind it, with no maybe row', async () => {
    const answer = await call(tables, 'impact', { symbol: LIST_ACTIVE });
    const ids = (answer.entries as Array<{ id: string }>).map((row) => row.id);
    expect(ids).toEqual(expect.arrayContaining(['entry:shop-api:http:GET:/api/orders/active', 'entry:staff-bot:bot_event:callback_query', 'entry:staff-bot:bot_command:orders']));
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
