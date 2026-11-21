import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from './server.js';
import { edge, node, writeTestDb } from './test-graph.js';
import { TOOL_NAMES } from './tool-needs.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const FIXTURE = join(ROOT, 'fixtures', 'multi-repo');

const dirs: string[] = [];
const clients: Client[] = [];
const tempDir = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `flowatlas-offered-${name}-`));
  dirs.push(dir);
  return dir;
};

afterAll(async () => {
  for (const client of clients) await client.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** A client of a server started on a database alone, as `flowatlas mcp --db` with no configuration starts one. */
const connect = async (dbPath: string) => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createFlowatlasServer({ dbPath, toolsPollMs: 0 }).connect(serverSide);
  const client = new Client({ name: 'offered-test', version: '0' });
  await client.connect(clientSide);
  clients.push(client);
  return client;
};

const answerOf = async (client: Client, name: string, args: Record<string, unknown>): Promise<any> => {
  const response = (await client.callTool({ name, arguments: { verbose: true, ...args } })) as { content: Array<{ text: string }>; structuredContent?: unknown; isError?: boolean };
  const answer = JSON.parse(response.content[0]!.text);
  // The text and structuredContent stay one document after the answer is rewritten.
  if (response.isError !== true) expect(response.structuredContent, name).toEqual(answer);
  return answer;
};

/**
 * One or more questions to every tool a server on the multi-repo database
 * lists, chosen so their answers suggest the next calls: a way in, a symbol, a
 * channel, a type, a crossing, a gap, a class and a service, a cut walk and a
 * clamped level.
 */
const QUESTIONS: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['start_here', {}],
  ['start_here', { service: 'gateway' }],
  ['list_entries', {}],
  ['find_symbol', { query: 'fetchOne' }],
  ['get_flow', { entry: 'entry:gateway:http:GET:/orders/:param', depth: 8 }],
  ['get_flow', { entry: 'POST /orders/:param/invoice' }],
  ['get_flow', { entry: 'entry:gateway:http:POST:/orders/:param/cancel', detail: 3 }],
  ['get_flow', { entry: 'GET /orders/1' }],
  ['who_calls', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne', depth: 2 }],
  ['who_calls', { symbol: 'GET /orders/123' }],
  ['impact', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne' }],
  ['impact', { symbol: 'OrdersService' }],
  ['who_emits', { channel: 'order.created' }],
  ['who_consumes', { channel: 'order.created' }],
  ['who_consumes', { channel: 'order.archived' }],
  ['who_emits', { channel: 'order.create' }],
  ['get_type', { type: 'type:@fx/contracts#OrderDto' }],
  ['get_type', { type: 'InvoiceDto' }],
  ['check_contract', { from: 'gateway', to: 'billing' }],
  ['describe_for_prompt', { id: 'entry:gateway:http:POST:/orders/:param/cancel' }],
  ['describe_for_prompt', { id: 'order.created' }],
  ['describe_for_prompt', { id: 'orders#src/orders/orders.service.ts:OrdersService.findOne' }],
  ['describe_for_prompt', { id: 'gap:web|src/app/orders-api.service.ts|api-path-dynamic' }],
  ['describe_for_prompt', { id: 'orders#src/orders/orders.service.ts:OrdersService', scope: 'class' }],
  ['describe_for_prompt', { id: 'orders#src/orders/orders.service.ts', scope: 'file' }],
  ['describe_for_prompt', { id: 'orders', scope: 'service' }],
  ['search', { query: 'orders' }],
  ['search', { query: 'dynamic', kinds: ['gaps'] }],
  ['cant_follow', {}],
  ['cant_follow', { service: 'gateway' }],
  ['dead', { id: 'GET /orders/latest' }],
  ['dead', { id: 'entry:orders:http:POST:/orders/:param/archive' }],
  ['dead', { id: 'orders#src/orders/orders.service.ts:OrdersService' }],
  ['dead', { service: 'orders' }],
  ['findings', {}],
  ['findings', { kind: 'unguarded' }],
  ['type_usage', { type: 'type:@fx/contracts#OrderDto' }],
  ['type_usage', { type: 'OrderDto' }],
  ['get_spec', { service: 'orders' }],
  ['get_spec', { service: 'billing', path: 'order.created' }],
];

/** The answer with what start_here says about the hidden tools left out: naming them there is its point. */
const suggestionsOf = (answer: Record<string, unknown>): string => JSON.stringify({ ...answer, hidden: undefined });

describe('a server on a database alone suggests no tool it hides (P360)', () => {
  let client: Client;
  let hidden: string[];
  let named: RegExp;

  beforeAll(async () => {
    const dir = tempDir('fixture');
    cpSync(join(FIXTURE, '.flowatlas'), dir, { recursive: true });
    client = await connect(join(dir, 'graph.db'));
    const listed = new Set((await client.listTools()).tools.map((tool) => tool.name));
    hidden = TOOL_NAMES.filter((name) => !listed.has(name));
    named = new RegExp(`\\b(?:${hidden.join('|')})\\b`);
  });

  it('hides get_source, which needs the repositories a configuration names', () => {
    expect(hidden).toContain('get_source');
  });

  it('asks every listed tool at least once', async () => {
    const listed = (await client.listTools()).tools.map((tool) => tool.name);
    expect(listed.filter((name) => !QUESTIONS.some(([asked]) => asked === name))).toEqual([]);
  });

  it('names no hidden tool in any answer, and says where to read the code instead', async () => {
    const offending: string[] = [];
    let reads = 0;
    for (const [name, args] of QUESTIONS) {
      const answer = await answerOf(client, name, args);
      const said = suggestionsOf(answer);
      const found = named.exec(said);
      if (found !== null) offending.push(`${name}(${JSON.stringify(args)}): ${said.slice(Math.max(0, found.index - 80), found.index + 60)}`);
      if (said.includes('the code is not served from a database alone')) reads += 1;
    }
    expect(offending).toEqual([]);
    expect(reads).toBeGreaterThan(0);
  });

  it('points a step it would have read at its file and line', async () => {
    const answer = await answerOf(client, 'dead', { id: 'GET /orders/latest' });
    expect(answer.next).toContainEqual(expect.stringMatching(/^read \S+\.ts:\d+ in \w+: the code is not served from a database alone$/));
  });

  it('names no hidden tool in the prompts it writes', async () => {
    for (const [name, args] of [
      ['before-rename', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne' }],
      ['trace-route', { route: 'entry:gateway:http:GET:/orders/:param' }],
      ['pr-review', {}],
    ] as const) {
      const prompt = await client.getPrompt({ name, arguments: args });
      const text = prompt.messages.map((message) => (message.content.type === 'text' ? message.content.text : '')).join('\n');
      expect(named.exec(text), name).toBeNull();
    }
  });

  it('starts the session with instructions whose chains name no tool it can never list', () => {
    const instructions = client.getInstructions() ?? '';
    const lines = instructions.split('\n').filter((line) => !line.startsWith('Only the tools this project can answer'));
    expect(lines.filter((line) => /\b(?:get_source|check_rules|test_pattern)\b/.test(line))).toEqual([]);
    expect(instructions).toContain('- entry: list_entries -> get_flow({entry: id}).');
    expect(instructions).toContain('This server serves no code');
  });
});

describe('a channel written with placeholders, asked of a server (P360)', () => {
  let client: Client;

  beforeAll(async () => {
    const dbPath = join(tempDir('channels'), 'graph.db');
    const channel = (name: string) => node(`channel:${name}`, { type: 'channel', label: name, repo: '' });
    writeTestDb(
      {
        nodes: [
          channel('tenant:*:events'),
          channel('tenant:*:audit'),
          node('producer:orders#src/orders.service.ts:20:5', { type: 'producer', label: 'publish tenant:*:events', file: 'src/orders.service.ts', line: 20 }),
          node('orders#src/events.handler.ts:EventsHandler.handle', { label: 'EventsHandler.handle', file: 'src/events.handler.ts', line: 8 }),
        ],
        edges: [
          edge('producer:orders#src/orders.service.ts:20:5', 'channel:tenant:*:events', { type: 'emits' }),
          edge('channel:tenant:*:events', 'orders#src/events.handler.ts:EventsHandler.handle', { type: 'consumes' }),
        ],
      },
      dbPath,
    );
    client = await connect(dbPath);
    await client.listTools();
  });

  it('answers who_consumes for the one channel it denotes, saying which', async () => {
    const answer = await answerOf(client, 'who_consumes', { channel: 'tenant:<id>:events' });
    expect(answer.channel.id).toBe('channel:tenant:*:events');
    expect(answer.channelUsed).toBe('channel:tenant:*:events');
    expect(answer.consumers.map((row: { id: string }) => row.id)).toEqual(['orders#src/events.handler.ts:EventsHandler.handle']);
    const emits = await answerOf(client, 'who_emits', { channel: 'channel:tenant:${tenantId}:events' });
    expect(emits.producers.map((row: { id: string }) => row.id)).toEqual(['producer:orders#src/orders.service.ts:20:5']);
    const valued = await answerOf(client, 'who_consumes', { channel: 'tenant:42:events' });
    expect(valued.channelUsed).toBe('channel:tenant:*:events');
  });

  it('answers an exact name as before, with no channelUsed', async () => {
    const answer = await answerOf(client, 'who_consumes', { channel: 'tenant:*:events' });
    expect(answer.channelUsed).toBeUndefined();
    expect(answer.consumers).toHaveLength(1);
  });

  it('lists the channels a name fits when it fits several', async () => {
    const answer = await answerOf(client, 'who_consumes', { channel: 'tenant:{id}:{kind}' });
    expect(answer.error).toBe('"tenant:{id}:{kind}" fits 2 channels; ask for one of them');
    expect(answer.suggestions.map((row: { id: string }) => row.id)).toEqual(['channel:tenant:*:audit', 'channel:tenant:*:events']);
    expect(answer.next).toEqual(['who_consumes({channel: "channel:tenant:*:audit"})', 'who_consumes({channel: "channel:tenant:*:events"})']);
  });

  it('reads the same name in the tools that take any node', async () => {
    const dead = await answerOf(client, 'dead', { id: 'tenant:<id>:events' });
    expect(dead.id).toBe('channel:tenant:*:events');
    expect(dead.channelUsed).toBe('channel:tenant:*:events');
    const described = await answerOf(client, 'describe_for_prompt', { id: 'tenant:42:events' });
    expect(described.id).toBe('channel:tenant:*:events');
    expect(described.channelUsed).toBe('channel:tenant:*:events');
    const callers = await answerOf(client, 'who_calls', { symbol: 'tenant:<id>:events' });
    expect(callers.target.id).toBe('channel:tenant:*:events');
    expect(callers.channelUsed).toBe('channel:tenant:*:events');
  });
});
