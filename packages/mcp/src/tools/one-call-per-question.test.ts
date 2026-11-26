import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withInputAliases } from '../input-aliases.js';
import { PLAIN_TEXT_TOOLS, plainTextOf } from '../plain-text.js';
import { createFlowatlasServer } from '../server.js';
import { READER_META } from './flow.js';

/**
 * A question is one call (P382), against two Nest services: a route whose
 * body only a guard reads, called with its parameter named otherwise than the
 * route names it; a type of message two channels carry and one that one
 * channel carries; a controller long enough that its skeleton says more than
 * its bodies.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'one-call-per-question', 'flowatlas.config.json');
const MULTI = join(ROOT, 'fixtures', 'multi-repo', 'flowatlas.config.json');

const CANCEL = 'entry:shop-api:http:PATCH:/api/orders/:param/cancel';
const CONTROLLER = 'shop-api#src/orders/orders.controller.ts:OrdersController';
const GUARD_READ = 'shop-api#src/auth/client.guard.ts:ClientGuard.clientRef';

interface Reply {
  content: Array<{ text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

const clients: Client[] = [];
let client: Client;

const connect = async (configPath: string): Promise<Client> => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer({ configPath, allTools: true, toolsPollMs: 0 }).connect(serverSide);
  const connected = new Client({ name: 'test', version: '0' });
  await connected.connect(clientSide);
  // Listed first, so the client checks each answer against the output schema its tool lists.
  await connected.listTools();
  clients.push(connected);
  return connected;
};

const reply = async (name: string, args: Record<string, unknown> = {}, on: Client = client): Promise<Reply> => (await on.callTool({ name, arguments: args })) as Reply;
const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => JSON.parse((await reply(name, args)).content[0]!.text);

beforeAll(async () => {
  client = await connect(CONFIG);
});

afterAll(async () => {
  for (const each of clients) await each.close();
});

describe('check_contract takes a question as an agent writes it (P382)', () => {
  it('reads `route` as `edge`, with the parameter named as the caller names it', async () => {
    const answer = await call('check_contract', { route: 'PATCH /api/orders/:orderId/cancel', field: 'userRef' });
    expect(answer.error).toBeUndefined();
    expect(answer.entry).toBe(CANCEL);
    expect(answer.reads.map((read: { id: string }) => read.id)).toEqual([GUARD_READ]);
    expect(answer.complete).toBe(true);
    expect(await call('check_contract', { entry: CANCEL, field: 'userRef' })).toEqual(answer);
    expect(await call('check_contract', { to: CANCEL, field: 'userRef' })).toEqual(answer);
  });

  it('answers a type of message given as the channel on the one channel carrying it', async () => {
    const answer = await call('check_contract', { channel: 'ORDER_READY' });
    expect(answer).toMatchObject({ channel: 'channel:order_updates', type: 'ORDER_READY', complete: true });
    expect(await call('check_contract', { channel: 'order_ready' })).toEqual(answer);
  });

  it('answers a type two channels carry on each of them, each compared alone', async () => {
    const answer = await call('check_contract', { channel: 'HELP_REQUESTED' });
    expect(answer.carriedBy).toEqual(['channel:desk_events', 'channel:floor_events']);
    expect(answer.answers.map((one: { channel: string }) => one.channel)).toEqual(answer.carriedBy);
    const [desk, floor] = answer.answers;
    expect(desk.missing.map((row: { field: string }) => row.field)).toEqual(['deskId']);
    expect(floor.missing ?? []).toEqual([]);
    expect(answer.complete).toBe(true);
  });

  it('names the exact calls to make on every input it cannot answer', async () => {
    const none = await reply('check_contract', {});
    expect(none.isError).toBe(true);
    expect(JSON.parse(none.content[0]!.text).next.length).toBeGreaterThan(0);

    const handler = await call('check_contract', { from: `${CONTROLLER}.cancel` });
    expect(handler.next).toEqual([`check_contract({edge: "${CANCEL}"})`]);

    const channel = await call('check_contract', { channel: 'NO_SUCH_THING' });
    expect(channel.error).toContain('no channel or type of message');
    expect(channel.next[0]).toMatch(/^check_contract\(\{channel: "channel:/);

    const route = await call('check_contract', { route: 'PATCH /api/nowhere/at/all' });
    expect(route.error).toContain('no way in matches');
    expect(route.next.length).toBeGreaterThan(0);

    const edge = await call('check_contract', { from: 'a', to: CANCEL });
    expect(edge.next[0]).toBe(`check_contract({edge: "${CANCEL}"})`);
  });
});

describe('code and Markdown handed on as text (P382)', () => {
  it('answers a class with its skeleton as plain text, each body folded, with line numbers', async () => {
    const answer = await reply('get_source', { symbol: 'OrdersController' });
    expect(answer.structuredContent).toBeUndefined();
    const text = answer.content[0]!.text;
    expect(text.split('\n')[0]).toBe(`// ${CONTROLLER} src/orders/orders.controller.ts:20-56 (skeleton: each body folded; whole: true for all)`);
    expect(text).toContain("29    async cancel(@Param('orderId') orderId: string, @Body() _body: CancelOrderBody): Promise<void> { … }");
    expect(text).toContain('48    listNotes(@Param(\'orderId\') orderId: string): string[] { … }');
    expect(text).not.toContain('pinnedA - pinnedB');
    expect(text).not.toContain('\\n');
    expect(text).toContain(`// next: get_source({symbol: "${CONTROLLER}", whole: true})`);
  });

  it('answers the class whole when asked, and the JSON document with verbose', async () => {
    const whole = (await reply('get_source', { symbol: CONTROLLER, whole: true })).content[0]!.text;
    expect(whole).toContain('pinnedA - pinnedB');
    const verbose = await reply('get_source', { symbol: CONTROLLER, verbose: true });
    expect(verbose.structuredContent).toMatchObject({ id: CONTROLLER, line: 20, endLine: 56, skeleton: true });
    expect(verbose.content[0]!.text).toBe(JSON.stringify(verbose.structuredContent));
    // Read on from a line inside it: the code there, not the skeleton.
    const page = (await reply('get_source', { symbol: CONTROLLER, fromLine: 47 })).content[0]!.text;
    expect(page).toContain('pinnedA - pinnedB');
  });

  it('answers describe_for_prompt as its Markdown, saying under it only what it does not', async () => {
    const answer = await reply('describe_for_prompt', { id: 'PATCH /api/orders/:orderId/cancel' });
    expect(answer.structuredContent).toBeUndefined();
    const text = answer.content[0]!.text;
    expect(text.startsWith('# Way in: PATCH /api/orders/:param/cancel')).toBe(true);
    expect(text).not.toMatch(/\nnext: /);
  });

  it('keeps an answer with no text to read as JSON', async () => {
    const candidates = await reply('get_source', { symbol: 'cancel' });
    expect(() => JSON.parse(candidates.content[0]!.text)).not.toThrow();
    expect(plainTextOf('get_source', { error: 'x', code: 'y' })).toBeUndefined();
    expect(plainTextOf('who_calls', { code: 'y', id: 'z' })).toBeUndefined();
  });
});

describe('get_flow at detail 2 says each fact once (P382)', () => {
  it('names no reader meta, no edge types the step signature says, and no fails or guards twice', async () => {
    const answer = await call('get_flow', { route: 'PATCH /api/orders/:orderId/cancel', detail: 2, verbose: true });
    const metas: Array<Record<string, unknown>> = [];
    const walk = (row: { node: { meta?: Record<string, unknown> }; children: unknown[] }): void => {
      if (row.node.meta !== undefined) metas.push(row.node.meta);
      for (const child of row.children) walk(child as typeof row);
    };
    walk(answer.root);
    expect(metas.length).toBeGreaterThan(5);
    for (const meta of metas) for (const key of READER_META) expect(Object.keys(meta), key).not.toContain(key);
    expect(answer.root.node.meta?.fails).toBeUndefined();
    expect(answer.root.fails).toBeDefined();
    const handler = answer.root.children[0];
    expect(handler.node.meta.signature.params.map((param: { type: string }) => param.type)).toEqual(['string', 'type:shop-api#CancelOrderBody']);
    expect(handler.edge).toEqual({ type: 'handles', confidence: 'static' });
  });

  it('leaves detail 1 as it was', async () => {
    const answer = await call('get_flow', { entry: CANCEL, verbose: true });
    expect(answer.root.children[0].edge.params).toBeDefined();
  });
});

describe('what the model reads is what the answer says (P382)', () => {
  /**
   * Claude Code hands the model `JSON.stringify(structuredContent)` on a
   * success, so the text and the structured content must be one document, or
   * what the answer budget measures is not what the model reads. Only the
   * tools that answer plain text carry none, and their text is not JSON.
   */
  it('holds on every success answer, compact and verbose, plain text only where the tool says so', async () => {
    const multi = await connect(MULTI);
    const asked: Array<[Client, string, Record<string, unknown>]> = [
      [multi, 'who_calls', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne' }],
      [multi, 'impact', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne' }],
      [multi, 'get_flow', { entry: 'entry:gateway:http:GET:/orders/:param', detail: 2 }],
      [multi, 'list_entries', { maxNodes: 3 }],
      [multi, 'find_symbol', { query: 'findOne' }],
      [multi, 'search', { query: 'orders' }],
      [multi, 'dead', { service: 'gateway' }],
      [multi, 'who_consumes', { channel: 'order.created' }],
      [multi, 'get_source', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne' }],
      [multi, 'describe_for_prompt', { id: 'entry:orders:http:POST:/orders' }],
      [multi, 'start_here', {}],
      [client, 'check_contract', { route: 'PATCH /api/orders/:orderId/cancel', field: 'userRef' }],
      [client, 'check_contract', { channel: 'HELP_REQUESTED' }],
      [client, 'get_source', { symbol: 'OrdersController' }],
    ];
    let plain = 0;
    for (const [on, name, args] of asked) {
      for (const verbose of [false, true]) {
        const answer = await reply(name, { ...args, verbose }, on);
        expect(answer.isError, name).toBeUndefined();
        if (answer.structuredContent === undefined) {
          expect(PLAIN_TEXT_TOOLS.has(name) && !verbose, name).toBe(true);
          plain += 1;
        } else expect(answer.content[0]!.text, name).toBe(JSON.stringify(answer.structuredContent));
      }
    }
    expect(plain).toBe(3);
  });

  it('reads the names agents reach for as each tool’s own input, never over one given', () => {
    expect(withInputAliases('check_contract', { route: 'GET /x', field: 'a' })).toEqual({ edge: 'GET /x', field: 'a' });
    expect(withInputAliases('check_contract', { route: 'GET /x', edge: 'GET /y' })).toEqual({ route: 'GET /x', edge: 'GET /y' });
    expect(withInputAliases('get_flow', { route: 'GET /x' })).toEqual({ entry: 'GET /x' });
    const untouched = { symbol: 'A.b' };
    expect(withInputAliases('who_calls', untouched)).toBe(untouched);
    expect(withInputAliases('search', { route: 'x' })).toEqual({ route: 'x' });
    expect(withInputAliases('dead', { symbol: 'A.b' })).toEqual({ id: 'A.b' });
    expect(withInputAliases('dead', { symbols: ['A.b'] })).toEqual({ ids: ['A.b'] });
  });
});
