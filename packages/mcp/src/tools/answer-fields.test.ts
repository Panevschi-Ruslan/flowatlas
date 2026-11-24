import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';

/**
 * Which fields of a route's answer each client reads (P391), against the
 * fixture where an Angular screen reads the order list through the async pipe
 * and a child it binds each row to, a React list through a query's data and a
 * row's props, a card a profile field the route never answers, and a panel
 * hands an order whole to a function of the platform.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'answer-fields-read', 'flowatlas.config.json');

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

describe('which fields of an answer each client reads', () => {
  it('names every read of the list, in a template, a child it is bound to and a React row, and the fields no client reads', async () => {
    const answer = await call('check_contract', { edge: 'GET /api/orders' });
    const said = answer.answer.reads.map((row: { field: string; id: string }) => `${row.field}@${row.id.split(':').pop()}`);
    expect(said).toEqual(
      expect.arrayContaining(['status@OrderRow', 'id@OrdersList', 'status@OrderBadgeComponent', 'id@OrdersComponent', 'total@OrdersComponent', 'discount@OrdersComponent']),
    );
    expect(answer.answer.missing).toEqual([expect.objectContaining({ field: 'discount', id: 'shop-web#src/app/orders.component.ts:OrdersComponent', file: 'src/app/orders.component.ts' })]);
    expect(answer.answer.unused.map((row: { field: string }) => row.field)).toEqual(['internalNote', 'placedAt']);
    expect(answer.complete).toBe(true);
  });

  it('keeps the reads of one field: the code that breaks if it changes', async () => {
    const answer = await call('check_contract', { edge: 'GET /api/orders', field: 'status' });
    expect(answer.answer.reads.map((row: { id: string }) => row.id).sort()).toEqual([
      'shop-app#src/OrdersList.tsx:OrderRow',
      'shop-web#src/app/order-badge.component.ts:OrderBadgeComponent',
    ]);
    expect(answer.answer.missing).toEqual([]);
  });

  it('says a field a client reads that the route never answers', async () => {
    const answer = await call('check_contract', { edge: 'GET /api/profile' });
    expect(answer.answer.missing).toEqual([expect.objectContaining({ field: 'nickname', id: 'shop-app#src/ProfileCard.tsx:ProfileCard', line: 17 })]);
  });

  it('follows a member into a method the template hands it to, and says an answer handed where it cannot be followed', async () => {
    const answer = await call('check_contract', { edge: 'GET /api/orders/:id' });
    expect(answer.answer.reads).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'customer.email', id: 'shop-web#src/app/order-detail.component.ts:OrderDetailComponent.email' })]));
    expect(answer.complete).toBe(false);
    expect(answer.left).toEqual(expect.arrayContaining([expect.stringContaining('handed to JSON.stringify')]));
    // A field read where a client hands the value on is never said unused.
    expect(answer.answer.unused).toEqual([]);
  });

  it('lists a field a client reads and the route never returns as a finding, and holds back a route whose answer is no shape read (P393)', async () => {
    const answer = await call('findings', { kind: 'answer-field-never-returned' });
    expect(answer.rows.map((row: { id: string; message: string }) => [row.id, row.message.split('`')[1]])).toEqual([
      ['shop-app#src/ProfileCard.tsx:ProfileCard', 'nickname'],
      ['shop-web#src/app/orders.component.ts:OrdersComponent', 'discount'],
    ]);
    expect(answer.rows[0]).toMatchObject({
      precision: 'high',
      from: 'ui_api_call:shop-app#src/api.ts:23:26',
      to: 'entry:shop-api:http:GET:/api/profile',
      loc: 'src/ProfileCard.tsx:17',
      next: 'check_contract({from: "ui_api_call:shop-app#src/api.ts:23:26", to: "entry:shop-api:http:GET:/api/profile"})',
    });
    expect(answer.rows[0].message).toContain('answers Profile (name, avatarUrl)');
    // GET /api/settings answers what JSON.parse gives: the theme its badge reads is not compared, and said so.
    expect(answer.heldBack['answer-field-never-returned']).toEqual({ count: 1, why: expect.stringContaining('what GET /api/settings answers is not a shape read') });
  });

  it('answers one request into the route with its own reads', async () => {
    const answer = await call('check_contract', { from: 'ui_api_call:shop-app#src/api.ts:23:26', to: 'entry:shop-api:http:GET:/api/profile' });
    expect(answer.answer.missing.map((row: { field: string }) => row.field)).toEqual(['nickname']);
    expect(answer.answer.reads.every((row: { call?: string }) => row.call === undefined)).toBe(true);
  });
});
