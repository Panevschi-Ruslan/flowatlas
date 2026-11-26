import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';

/**
 * What a pilot on a real project got wrong after P368-P373 (P374), against a
 * back end whose cancel method a guarded route, a chat bot's webhook (in a
 * worker file, handing the pressed button to the bot's class) and a screen
 * reach; a guard reading the client's id through a key it holds as a
 * default; a notice service nothing builds subscribing next to a screen that
 * subscribes for real; and a subscriber to every channel of a bus whose cart
 * channels publish no type.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'rows-name-handling-code', 'flowatlas.config.json');
const CANCEL = 'shop-api#src/orders/orders.service.ts:OrdersService.cancel';

let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}, verbose = true): Promise<any> => {
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

describe('impact names the code that handles each way in', () => {
  it('the route its handler, the webhook the bot class behind the worker, the screen its component', async () => {
    const answer = await call('impact', { symbol: CANCEL });
    expect(answer.entries.map((row: { id: string; by?: string }) => [row.id, row.by])).toEqual([
      ['entry:shop-api:http:PATCH:/api/orders/:param/cancel', 'shop-api#src/orders/orders.controller.ts:OrdersController.cancel'],
      ['entry:shop-api:http:POST:/bot/staff/webhook', 'shop-api#src/bot/staff-bot.service.ts:StaffBot.handleCallbackQuery'],
      ['entry:shop-web:screen:/orders/:param', 'shop-web#src/app/order-detail.component.ts:OrderDetailComponent'],
    ]);
    expect(answer.complete).toBe(true);
  });

  it('keeps `by` in the compact answer', async () => {
    const answer = await call('impact', { symbol: CANCEL }, false);
    expect(answer.entries.map((row: { by?: string }) => row.by)).toEqual([
      'shop-api#src/orders/orders.controller.ts:OrdersController.cancel',
      'shop-api#src/bot/staff-bot.service.ts:StaffBot.handleCallbackQuery',
      'shop-web#src/app/order-detail.component.ts:OrderDetailComponent',
    ]);
  });
});

describe('a field a guard reads through a key it holds as a default', () => {
  it('is read in the guard method, said a default', async () => {
    const answer = await call('check_contract', { edge: 'PATCH /api/orders/:id/cancel', field: 'userRef' });
    expect(answer.reads).toEqual([{ field: 'userRef', id: 'shop-api#src/auth/client.guard.ts:ClientGuard.suppliedId', line: 34, layer: 'guard', sureness: 'default' }]);
    expect(answer.complete).toBe(true);
  });

  it('a use the reading cannot follow names the method it is in', async () => {
    const answer = await call('check_contract', { edge: 'PATCH /api/orders/:id/note' });
    expect(answer.left).toEqual(['unsure: guard NoteGuard.noteOf: spread into another value, line 16']);
  });

  it('a compact row keeps a field named as the method reading it', async () => {
    const answer = await call('check_contract', { edge: 'PATCH /api/orders/:id/note' }, false);
    expect(answer.reads.map((row: { field?: string }) => row.field)).toEqual(['note']);
  });
});

describe('consumers', () => {
  it('a branch toasting a field is handled where it is written, and never runs where nothing builds its class', async () => {
    const answer = await call('who_consumes', { channel: 'desk_alerts', type: 'HELP_REQUESTED' });
    const rows = answer.consumers.map((row: { id: string; reach?: string; from?: string }) => [row.id, row.reach, row.from]);
    expect(rows).toEqual([
      ['consumer:shop-api#src/notify/alert-relay.service.ts:AlertRelay.pageStaff', 'alive', 'POST /api/desks/:param/help'],
      ['consumer:shop-web#src/app/desk-board.component.ts:DeskBoardComponent.reload', 'alive', 'screen /desks'],
      ['consumer:shop-web#src/app/order-notices.service.ts:OrderNotices.handle', 'dead', 'none'],
    ]);
    expect(JSON.stringify(answer)).not.toContain('Toast.showInfo');
  });

  it('the subscriber to every channel draws its type only on the channel that publishes it', async () => {
    const answer = await call('search', { query: 'HELP_REQUESTED' });
    expect(answer.results.messages.map((row: { id: string }) => row.id)).toEqual(['channel:desk_alerts#HELP_REQUESTED']);
    expect(answer.results.messages[0].handlers).toEqual([
      'consumer:shop-api#src/notify/alert-relay.service.ts:AlertRelay.pageStaff',
      'consumer:shop-web#src/app/desk-board.component.ts:DeskBoardComponent.reload',
    ]);
  });
});
