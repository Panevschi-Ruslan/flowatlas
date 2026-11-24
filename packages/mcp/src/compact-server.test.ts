import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compactAnswer } from './compact.js';
import { createFlowatlasServer } from './server.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const CONFIG = join(ROOT, 'fixtures', 'multi-repo', 'flowatlas.config.json');

let client: Client;

interface Reply {
  content: Array<{ text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

const ask = async (name: string, args: Record<string, unknown>): Promise<Reply> => (await client.callTool({ name, arguments: args })) as Reply;

beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createFlowatlasServer({ configPath: CONFIG, allTools: true, toolsPollMs: 0 });
  await server.connect(serverSide);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  // Listed first, so the client checks every answer below against the output schema the tool lists.
  await client.listTools();
});

afterAll(async () => {
  await client.close();
});

const SYMBOL = 'orders#src/orders/orders.service.ts:OrdersService.findOne';

/** Questions an agent asks most, each answered compact and whole. */
const QUESTIONS: Array<[string, Record<string, unknown>]> = [
  ['get_flow', { entry: 'entry:gateway:http:GET:/orders/:param' }],
  ['who_calls', { symbol: SYMBOL, depth: 6 }],
  ['impact', { symbol: SYMBOL }],
  ['list_entries', { maxNodes: 3 }],
  ['find_symbol', { query: 'fetchOne' }],
  ['search', { query: 'orders' }],
  ['dead', { service: 'gateway' }],
  ['who_consumes', { channel: 'order.created', detail: 2 }],
];

describe('compact answers at the boundary (P365)', () => {
  it('lists verbose on every tool, and output schemas that require no field', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
      expect(properties.verbose, tool.name).toEqual({ type: 'boolean' });
      if (tool.outputSchema !== undefined) expect(JSON.stringify(tool.outputSchema), tool.name).not.toContain('"required"');
    }
  });

  it('answers compact by default, the whole answer compacted, and whole with verbose: true', async () => {
    let whole = 0;
    let compact = 0;
    for (const [name, args] of QUESTIONS) {
      const full = await ask(name, { ...args, verbose: true });
      const short = await ask(name, args);
      expect(short.isError, name).toBeUndefined();
      expect(JSON.parse(short.content[0]!.text), name).toEqual(compactAnswer(JSON.parse(full.content[0]!.text)));
      expect(short.structuredContent, name).toEqual(JSON.parse(short.content[0]!.text));
      whole += full.content[0]!.text.length;
      compact += short.content[0]!.text.length;
    }
    // 17,126 against 24,007 when measured: the fixture's rows at detail 1 were
    // slimmed before (P93), and what is left is ids, edges and Markdown.
    // 18,845 against 25,532 once P364's reach, from and complete are on the
    // rows: compaction keeps them, since each answers a call.
    expect(compact).toBeLessThan(whole * 0.75);
  });

  it('never hands verbose to the tool: a cut list pages with the call an agent would write', async () => {
    const full = JSON.parse((await ask('list_entries', { maxNodes: 2, verbose: true })).content[0]!.text);
    const short = JSON.parse((await ask('list_entries', { maxNodes: 2 })).content[0]!.text);
    expect(full.next[0]).toBe('list_entries({maxNodes: 2, offset: 2})');
    expect(short.next).toEqual(['list_entries({maxNodes: 2, offset: 2})']);
    expect(short.total).toBe(full.total);
  });

  it('says on a row only what its id does not', async () => {
    const answer = JSON.parse((await ask('who_calls', { symbol: SYMBOL, depth: 6 })).content[0]!.text);
    const rows: Array<Record<string, unknown>> = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object' && value !== null) {
        const row = value as Record<string, unknown>;
        if (typeof row.id === 'string') rows.push(row);
        Object.values(row).forEach(walk);
      }
    };
    walk(answer);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      const id = row.id as string;
      if (typeof row.type === 'string') expect(id.startsWith(`${row.type}:`), id).toBe(false);
      if (typeof row.service === 'string') expect(id.startsWith(`${row.service}#`), id).toBe(false);
      if (typeof row.loc === 'string') expect(id.includes(`#${row.loc.split(':')[0]}:`), id).toBe(false);
    }
    expect(rows.some((row) => typeof row.line === 'number')).toBe(true);
  });

  /** Code and Markdown as the text they are (P382): no structured content to escape them into. */
  it('hands get_source and describe_for_prompt over as plain text, and the document with verbose: true', async () => {
    const full = await ask('get_source', { symbol: SYMBOL, verbose: true });
    const short = await ask('get_source', { symbol: SYMBOL });
    const code = (JSON.parse(full.content[0]!.text) as { code: string }).code;
    expect(short.structuredContent).toBeUndefined();
    expect(short.content[0]!.text).toContain(code);
    const markdown = (JSON.parse((await ask('describe_for_prompt', { id: 'entry:orders:http:POST:/orders', verbose: true })).content[0]!.text) as { markdown: string }).markdown;
    const said = await ask('describe_for_prompt', { id: 'entry:orders:http:POST:/orders' });
    expect(said.structuredContent).toBeUndefined();
    expect(said.content[0]!.text.startsWith(markdown.trimEnd())).toBe(true);
  });
});
