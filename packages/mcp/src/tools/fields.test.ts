import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';

/**
 * Which code reads or sends a field of a message or a request body, in one
 * call (P368), against the fixture where a frame's one optional field is read
 * behind a dispatch by type, a route's body is read only by its guard, and a
 * type's handler reads a field its publish never sends.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'fields-read-and-sent', 'flowatlas.config.json');
const BOT = 'ops-bot#src/bot/bot.service.ts:BotService';
const NOTIFY = 'ops-bot#src/notify/notify.service.ts:NotifyService';

let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}, verbose = true): Promise<any> => {
  const response = (await client.callTool({ name, arguments: { verbose, ...args } })) as { content: Array<{ text: string }> };
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

describe('who reads a field of a message', () => {
  it('names the handler and the line, through the dispatch by type that chose it', async () => {
    const answer = await call('who_consumes', { channel: 'order_updates', type: 'ORDER_READY', field: 'label' });
    expect(answer.field).toBe('label');
    expect(answer.consumers).toHaveLength(1);
    expect(answer.consumers[0]).toMatchObject({ id: `consumer:${BOT}.handleOrderReady`, readIn: [{ id: `${BOT}.handleOrderReady`, line: 17 }] });
    expect(answer.complete).toBe(true);
  });

  it('keeps no handler that reads the field only under another type', async () => {
    const answer = await call('who_consumes', { channel: 'order_updates', type: 'ORDER_READY', field: 'reason' });
    expect(answer.consumers).toEqual([]);
    const cancelled = await call('who_consumes', { channel: 'order_updates', type: 'ORDER_CANCELLED', field: 'reason' });
    expect(cancelled.consumers[0].readIn).toEqual([{ id: `${BOT}.handleOrderCancelled`, line: 23 }]);
  });

  it('lists the fields each end reads or sends at detail 2', async () => {
    const consumers = await call('who_consumes', { channel: 'order_updates', detail: 2 });
    expect(consumers.consumers[0].reads).toEqual(['label', 'orderId', 'reason', 'type']);
    const producers = await call('who_emits', { channel: 'order_updates', type: 'ORDER_READY', detail: 2 });
    expect(producers.producers[0].sends).toEqual(['type', 'orderId', 'label']);
    const sending = await call('who_emits', { channel: 'order_updates', field: 'reason' });
    expect(sending.producers.map((row: { id: string }) => row.id)).toEqual(['producer:shop-api#src/orders/orders.service.ts:16:11']);
  });
});

describe('who reads a field of a request body', () => {
  it('names the guard that reads it where the handler ignores the body', async () => {
    const answer = await call('check_contract', { edge: 'PATCH /api/orders/:id/cancel', field: 'userRef' });
    expect(answer.entry).toBe('entry:shop-api:http:PATCH:/api/orders/:param/cancel');
    expect(answer.reads).toEqual([{ field: 'userRef', id: 'shop-api#src/auth/client.guard.ts:ClientGuard.clientRef', line: 17, layer: 'guard' }]);
    expect(answer.complete).toBe(true);
  });

  it('lists every field the path reads without a field, the handler included', async () => {
    const answer = await call('check_contract', { edge: 'entry:shop-api:http:POST:/api/orders/:param/ready' });
    expect(answer.reads).toEqual([{ field: 'label', id: 'shop-api#src/orders/orders.controller.ts:OrdersController.ready', line: 27, layer: 'handler' }]);
  });
});

describe('whether a publish sends what its handlers read', () => {
  it('names the field read and not sent, and the one sent and never read', async () => {
    const answer = await call('check_contract', { channel: 'desk_events', type: 'HELP_REQUESTED' });
    // Read behind `if (!evt.deskId) return;` (P405): the handler drops the message, it does not fail.
    expect(answer.missing).toEqual([{ field: 'deskId', id: `${NOTIFY}.onDeskEvent`, line: 16, guarded: true, effect: 'returns early' }]);
    expect(answer.unused).toEqual([{ field: 'deskNumber', sentBy: ['producer:shop-api#src/desk/desk.service.ts:10:11'] }]);
    expect(answer.producers[0].sends).toEqual(['type', 'deskNumber', 'note']);
    expect(answer.complete).toBe(true);
  });

  it('compares a channel type by type, never a read of one type against a publish of another', async () => {
    const answer = await call('check_contract', { channel: 'order_updates' });
    expect(answer.missing).toEqual([]);
    expect(answer.unused).toEqual([{ type: 'ORDER_READY', field: 'orderId', sentBy: ['producer:shop-api#src/orders/orders.service.ts:11:11'] }]);
  });
});

describe('a field by its name', () => {
  it('is found by search, on the type it crosses, with how many read and send it', async () => {
    const answer = await call('search', { query: 'label', kinds: ['fields'] });
    expect(answer.results.fields[0]).toMatchObject({ id: 'channel:order_updates#ORDER_READY', type: 'field', label: 'label', read: 1, sent: 1 });
    expect(answer.next[0]).toBe('who_consumes({channel: "channel:order_updates", type: "ORDER_READY", field: "label"})');
  });
});

describe('compact', () => {
  it('answers each of the three questions in one short call', async () => {
    const one = JSON.stringify(await call('who_consumes', { channel: 'order_updates', type: 'ORDER_READY', field: 'label' }, false));
    const two = JSON.stringify(await call('check_contract', { edge: 'PATCH /api/orders/:id/cancel', field: 'userRef' }, false));
    const three = JSON.stringify(await call('check_contract', { channel: 'desk_events', type: 'HELP_REQUESTED' }, false));
    expect(one).toContain('"readIn":[{"id":"ops-bot#src/bot/bot.service.ts:BotService.handleOrderReady","line":17}]');
    expect(two).toContain('ClientGuard.clientRef');
    expect(three).toContain('"missing":[{"field":"deskId"');
    for (const answer of [one, two, three]) expect(answer.length).toBeLessThan(1000);
  });
});
