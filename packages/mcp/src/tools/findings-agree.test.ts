import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';

/**
 * Findings and verdicts that agree with each other (P400), against the
 * fixture where a catalog wraps every answer in `{ success, data }` and its
 * product route's serializer leaves a field out, a report route passes
 * through an interceptor whose reshaping is not read, a relay hands one type
 * of the catalog's channel to a handler and the rest to another in its `else`,
 * and the catalog's chat bot is posted its updates at an address nothing in
 * the project calls; and the fixture of P395, whose screen chooses a type
 * through a feed one of whose channels is not read.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const AGREE = join(ROOT, 'fixtures', 'findings-that-agree', 'flowatlas.config.json');
const HOLD = join(ROOT, 'fixtures', 'findings-that-hold', 'flowatlas.config.json');

const clients: Record<string, Client> = {};

const call = async (config: string, name: string, args: Record<string, unknown> = {}): Promise<any> => {
  const response = (await clients[config]!.callTool({ name, arguments: { verbose: true, ...args } })) as { content: Array<{ text: string }> };
  const text = response.content[0]!.text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

beforeAll(async () => {
  for (const config of [AGREE, HOLD]) {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const server = createFlowatlasServer({ configPath: config, allTools: true });
    await server.connect(serverSide);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientSide);
    clients[config] = client;
  }
});

afterAll(async () => {
  for (const client of Object.values(clients)) await client.close();
});

describe('findings and verdicts that agree (P400)', () => {
  it('holds back "nothing selects a type" where a screen choosing it is fed through a stream relaying a channel not read', async () => {
    const answer = await call(HOLD, 'findings', { kind: 'message-type-unselected' });
    // ORDER_SHIPPED stays: nothing choosing it is fed through a channel not read.
    expect(answer.rows.map((row: { message: string }) => row.message.split(':')[0])).toEqual(['no code that runs selects ORDER_SHIPPED on shop']);
    expect(answer.heldBack['message-type-unselected']).toEqual({
      count: 1,
      why: 'handleFeed chooses ALERT_RAISED, and 1 subscription(s) behind GET /shops/:param/feed name a channel not read',
    });
  });

  it("counts a service's contract warnings in describe_for_prompt, with the call that lists them", async () => {
    const answer = await call(HOLD, 'describe_for_prompt', { id: 'back-office', scope: 'service' });
    const markdown = typeof answer === 'string' ? answer : answer.markdown;
    expect(markdown).toContain('- contract-break at warning · 7, counted, not listed: `findings({kind: "contract-break", severity: "warning", service: "back-office"})`');
    expect(markdown).toContain('- contract-break · 1');
  });

  it("says a webhook nothing calls that hands its request to a bot's code is the bot's way in", async () => {
    const answer = await call(AGREE, 'dead', { id: 'entry:catalog-api:http:POST:/tg/:param' });
    expect(answer).toMatchObject({ verdict: 'unknown', class: 'infrastructure', role: 'bot', evidence: { outside: 'bot' } });
  });

  it('gives the handler of the last else the types the channel carries that the branches before it do not choose', async () => {
    const answer = await call(AGREE, 'findings', { kind: 'field-never-sent' });
    // `reason` is read by the else's handler, which takes STOCK_LOW and PRODUCT_RETIRED: only STOCK_LOW lacks it.
    expect(answer.rows.map((row: { message: string }) => row.message)).toEqual([
      '`reason` is read by CatalogHandlers.onCatalogEvent on catalog_events (STOCK_LOW) and sent by none of its publishers',
    ]);
    const unselected = await call(AGREE, 'findings', { kind: 'message-type-unselected' });
    expect(unselected.rows).toEqual([]);
  });

  it('compares the answer a client reads against the wire: the envelope around it, the fields a serializer leaves out', async () => {
    const contract = await call(AGREE, 'check_contract', { edge: 'GET /products/:id' });
    expect(contract.answer.wire).toBe('{ data: ProductCard, success } (EnvelopeInterceptor); costPrice left out by ClassSerializerInterceptor (@Exclude)');
    expect(contract.answer.missing.map((row: { field: string; excluded?: string; wrapped?: boolean }) => [row.field, row.excluded ?? row.wrapped])).toEqual([
      ['price', true],
      ['data.costPrice', 'ClassSerializerInterceptor (@Exclude)'],
    ]);
    const answer = await call(AGREE, 'findings', { kind: 'answer-field-never-returned' });
    expect(answer.rows.map((row: { message: string }) => row.message.split(' ')[0])).toEqual(['`data.costPrice`', '`price`']);
    expect(answer.rows.find((row: { message: string }) => row.message.startsWith('`price`')).fix).toBe('the answer is wrapped: read `data.price`, or stop reading it');
  });

  it('holds the reads of an answer back where an interceptor reshapes it in a way not read', async () => {
    const answer = await call(AGREE, 'findings', { kind: 'answer-field-never-returned' });
    expect(answer.heldBack['answer-field-never-returned'].why).toContain('the answer to GET /reports/daily is reshaped on the way out in a way not read (TotalsInterceptor');
    const contract = await call(AGREE, 'check_contract', { edge: 'GET /reports/daily' });
    expect(contract.answer.missing[0]).toMatchObject({ field: 'data.revenue', unsure: expect.stringContaining('TotalsInterceptor') });
  });
});
