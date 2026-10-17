import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readGraphFile, resolveNodeId } from '../../../../scripts/fixture-nodes.mjs';
import { createFlowatlasServer } from '../server.js';
import type { FlowNode } from '../query/types.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURE = join(ROOT, 'fixtures', 'multi-repo');
const CONFIG = join(FIXTURE, 'flowatlas.config.json');

/**
 * The graph the server is about to answer from, read as data.
 *
 * The questions below are about requests, and a request's id carries the line
 * it was written at. Asking for it by the client method that makes it means
 * adding a line to a fixture moves the snapshots, which are regenerated, and
 * moves nothing here.
 */
const graph = readGraphFile(join(FIXTURE, '.flowatlas', 'project-graph.json'));

/** The one request the named client method makes. */
const requestIn = (method: string): string =>
  resolveNodeId(graph, { type: 'http_out', calledBy: method });

let client: Client;

const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
  const response = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ text: string }>;
  };
  return JSON.parse(response.content[0]!.text);
};

beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createFlowatlasServer({ configPath: CONFIG });
  await server.connect(serverSide);
  client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client.close();
});

/** Every node in a tree, so an assertion can be made about all of them. */
const flatten = (node: FlowNode): FlowNode[] => [
  node,
  ...node.children.flatMap((child) => flatten(child)),
];

describe('the tools a session is offered', () => {
  it('are exactly the fifteen the project promises', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'cant_follow',
      'check_contract',
      'describe_for_prompt',
      'find_symbol',
      'get_flow',
      'get_source',
      'get_type',
      'impact',
      'list_entries',
      'search',
      'start_here',
      'what_changed',
      'who_calls',
      'who_consumes',
      'who_emits',
    ]);
  });

  it('each describe what they are for', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) expect(tool.description?.length ?? 0).toBeGreaterThan(40);
  });

  it('are all read-only, closed-world and idempotent, each with a title', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toEqual({ readOnlyHint: true, openWorldHint: false, idempotentHint: true });
      expect(tool.title, tool.name).toBeTruthy();
    }
  });

  /**
   * What an assistant reads before its first call (P93): each tool's name,
   * description and input schema, which is what a client hands the model.
   * Output schemas, titles and annotations are for the client and go in the
   * second, wider ceiling, so neither part can creep back unnoticed.
   */
  it('cost less to read than they did', async () => {
    const { tools } = await client.listTools();
    const read = JSON.stringify(tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })));
    expect(read.length).toBeLessThan(8000);
    expect(JSON.stringify({ tools }).length).toBeLessThan(21000);
  });

  it('declare an output schema where the shape of the answer is settled', async () => {
    const { tools } = await client.listTools();
    expect(tools.filter((tool) => tool.outputSchema !== undefined).map((tool) => tool.name).sort()).toEqual([
      'cant_follow',
      'find_symbol',
      'get_source',
      'get_type',
      'list_entries',
      'search',
      'start_here',
      'who_consumes',
      'who_emits',
    ]);
  });

  /** Every recorded answer, of every suite, against the schema of the tool that gave it. */
  it('answer every snapshot in the shape their output schema declares', async () => {
    const { tools } = await client.listTools();
    const validator = new AjvJsonSchemaValidator();
    const schemas = new Map(tools.flatMap((tool) => (tool.outputSchema === undefined ? [] : [[tool.name, validator.getValidator(tool.outputSchema)] as const])));
    let checked = 0;
    for (const suite of ['multi-repo', 'nest-check-through-helper', 'loops-worth-fixing', 'multi-repo-plumbing']) {
      const dir = join(ROOT, 'fixtures', suite, 'expected.mcp');
      for (const file of readdirSync(dir)) {
        const validate = schemas.get(file.split('.')[0]!);
        const answer = JSON.parse(readFileSync(join(dir, file), 'utf8'));
        if (validate === undefined || 'error' in answer) continue;
        const result = validate(answer);
        expect(result.valid, `${suite}/${file}: ${result.errorMessage ?? ''}`).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(10);
    // Strict, so a field nobody declared fails rather than slipping through.
    expect(schemas.get('list_entries')!({ entries: [], total: 0, extra: 1 }).valid).toBe(false);
  });

  it('carry the answer as structuredContent too, the same document as the text', async () => {
    const reply = (await client.callTool({ name: 'list_entries', arguments: { maxNodes: 2 } })) as {
      content: Array<{ text: string }>;
      structuredContent?: unknown;
    };
    expect(reply.content[0]!.text).not.toContain('\n');
    expect(reply.structuredContent).toEqual(JSON.parse(reply.content[0]!.text));
  });
});

describe('reading a list a page at a time', () => {
  it('says where the next page starts, and that page holds the next rows', async () => {
    const all = await call('list_entries', {});
    const first = await call('list_entries', { maxNodes: 2 });
    expect(first.nextOffset).toBe(2);
    expect(first.total).toBe(all.total);
    expect(first.next[0]).toBe('list_entries({maxNodes: 2, offset: 2})');
    const second = await call('list_entries', { maxNodes: 2, offset: 2 });
    expect(second.entries.map((entry: { id: string }) => entry.id)).toEqual(
      all.entries.slice(2, 4).map((entry: { id: string }) => entry.id),
    );
    expect(second.nextOffset).toBe(4);
  });

  it('answers a page past the end with no rows, the total, and no next page', async () => {
    const past = await call('list_entries', { offset: 500 });
    expect(past.entries).toEqual([]);
    expect(past.total).toBeGreaterThan(0);
    expect(past.nextOffset).toBeUndefined();
    expect(past.truncated).toBeUndefined();
  });

  it('pages find_symbol, impact and the ends of a channel the same way', async () => {
    const found = await call('find_symbol', { query: 'orders', maxNodes: 1 });
    expect(found.nextOffset).toBe(1);
    expect((await call('find_symbol', { query: 'orders', maxNodes: 1, offset: 1 })).matches[0].id).not.toBe(found.matches[0].id);
    const symbol = 'orders#src/orders/orders.service.ts:OrdersService.findOne';
    const impact = await call('impact', { symbol, maxNodes: 1 });
    expect(impact).toMatchObject({ total: 2, nextOffset: 1 });
    expect(impact.next[0]).toBe(`impact({symbol: ${JSON.stringify(symbol)}, maxNodes: 1, offset: 1})`);
    const emits = await call('who_emits', { channel: 'order.created', offset: 1 });
    expect(emits).toMatchObject({ producers: [], total: 1 });
  });

  it('pages search by kind, asking again only for the kinds that had more', async () => {
    const first = await call('search', { query: 'orders', limit: 1 });
    const cut = Object.keys(first.counts).filter((kind) => first.counts[kind] > 1);
    expect(cut.length).toBeGreaterThan(0);
    expect(first.nextOffset).toBe(1);
    expect(first.next[0]).toBe(`search({query: "orders", kinds: ${JSON.stringify(cut)}, limit: 1, offset: 1})`);
    const second = await call('search', { query: 'orders', limit: 1, offset: 1, kinds: cut });
    expect(second.results[cut[0]!][0].id).not.toBe(first.results[cut[0]!][0].id);
  });
});

describe('finding a way in', () => {
  it('lists the routes of one service', async () => {
    const listed = await call('list_entries', { service: 'billing' });
    expect(listed.entries.map((entry: { id: string }) => entry.id)).toEqual([
      'entry:billing:event:invoice.requested',
      'entry:billing:event:order.created',
      'entry:billing:http:GET:/invoices/:param',
      'entry:billing:http:POST:/invoices',
    ]);
  });

  it('narrows by kind and by path', async () => {
    const byKind = await call('list_entries', { service: 'billing', kind: 'http' });
    expect(byKind.entries).toHaveLength(2);
    const byPath = await call('list_entries', { pathPrefix: '/invoices' });
    expect(byPath.entries.map((entry: { id: string }) => entry.id)).toEqual([
      'entry:billing:http:GET:/invoices/:param',
      'entry:billing:http:POST:/invoices',
    ]);
  });

  it('says how many it left out', async () => {
    const listed = await call('list_entries', { maxNodes: 2 });
    expect(listed.entries).toHaveLength(2);
    expect(listed.truncated).toBe(`${listed.total - 2} more; next page offset 2`);
    expect(listed.total).toBeGreaterThan(2);
  });

  it('finds a symbol from half a name', async () => {
    const found = await call('find_symbol', { query: 'fetchOne' });
    expect(found.matches[0].id).toContain('OrdersClient.fetchOne');
  });

  it('finds a symbol from its initials', async () => {
    const found = await call('find_symbol', { query: 'ocf' });
    expect(found.matches.map((match: { label: string }) => match.label)).toContain(
      'OrdersClient.fetchOne',
    );
  });

  it('refuses to guess from one letter', async () => {
    expect(await call('find_symbol', { query: 'a' })).toEqual({ matches: [], note: 'query too short' });
  });
});

describe('following an entry across services', () => {
  it('crosses from one repository into another and reaches the data', async () => {
    const flow = await call('get_flow', {
      entry: 'entry:gateway:http:GET:/orders/:param',
      depth: 8,
    });
    const ids = flatten(flow.root).map((item) => item.node.id);

    expect(ids).toContain('entry:orders:http:GET:/orders/:param');
    expect(ids).toContain('table:orders#orders');
    expect(flow.unresolvedOnPath).toBe(0);
  });

  it('marks the hop between services for what it is', async () => {
    const flow = await call('get_flow', { entry: 'entry:gateway:http:GET:/orders/:param' });
    const hop = flatten(flow.root).find(
      (item) => item.node.id === 'entry:orders:http:GET:/orders/:param',
    );
    expect(hop?.edge).toMatchObject({ type: 'http_calls', confidence: 'static' });
  });

  it('gives every edge in the answer a confidence', async () => {
    const flow = await call('get_flow', { entry: 'entry:gateway:http:GET:/orders/:param', detail: 2 });
    for (const item of flatten(flow.root).slice(1)) {
      expect(item.edge?.confidence).toBeTruthy();
    }
  });

  it('offers the choices when a route name means two services', async () => {
    const flow = await call('get_flow', { entry: 'GET /orders/1' });
    expect(flow.candidates.map((item: { service: string }) => item.service)).toEqual([
      'gateway',
      'orders',
    ]);
    expect(flow.root).toBeUndefined();
  });

  it('suggests something when nothing matches', async () => {
    const flow = await call('get_flow', { entry: 'GET /nowhere' });
    expect(flow.error).toContain('no entry matches');
    expect(Array.isArray(flow.suggestions)).toBe(true);
  });

  it('stays within the node budget and says what it cut', async () => {
    const flow = await call('get_flow', {
      entry: 'entry:gateway:http:GET:/orders/:param',
      maxNodes: 5,
    });
    expect(flatten(flow.root).length).toBeLessThanOrEqual(5);
    // The node cap stopped it, so raising depth would change nothing (P92).
    expect(flow.truncated).toMatch(/^\d+ more nodes past maxNodes 5; raise maxNodes or ask get_flow on a child id$/);
    expect(flow.stoppedBy).toEqual(['maxNodes']);
  });

  it('shows sixty rows unless told otherwise, and stops at about twelve thousand characters (P92)', async () => {
    const { tools } = await client.listTools();
    const schema = tools.find((tool) => tool.name === 'get_flow')?.inputSchema.properties as Record<string, { default?: unknown }>;
    expect(schema['maxNodes']?.default).toBe(60);
    expect(schema['maxChars']?.default).toBe(12000);
    const flow = await call('get_flow', { entry: 'entry:gateway:http:GET:/orders/:param', maxChars: 1500 });
    expect(flow.stoppedBy).toEqual(['maxChars']);
    expect(flow.truncated).toContain('past about 1500 characters; raise maxChars');
  });

  it('points next at the contract of the first HTTP crossing it reached (P92)', async () => {
    const flow = await call('get_flow', { entry: 'entry:gateway:http:GET:/orders/:param' });
    const request = requestIn('gateway#src/clients/orders.client.ts:OrdersClient.fetchOne');
    expect(flow.next).toContain(`check_contract({from: ${JSON.stringify(request)}, to: "entry:orders:http:GET:/orders/:param"})`);
    expect(flow.next.indexOf(flow.next.find((hint: string) => hint.startsWith('check_contract')))).toBeLessThan(
      flow.next.findIndex((hint: string) => hint.startsWith('impact')),
    );
  });

  it('names the crossing it did not follow, and offers to follow it (P92)', async () => {
    const flow = await call('get_flow', { entry: 'entry:gateway:http:GET:/orders/:param', maxNodes: 4 });
    expect(flow.crossingsLeft.length).toBeGreaterThan(0);
    expect(flow.next).toContain(`get_flow({entry: ${JSON.stringify(flow.crossingsLeft[0].to)}})`);
  });

  it('answers a request for source at level two, and says why', async () => {
    const flow = await call('get_flow', { entry: 'entry:gateway:http:GET:/orders/:param', detail: 3 });
    expect(flow.note).toBe('detail clamped to 2; use get_source');
    for (const item of flatten(flow.root)) expect(item.node).not.toHaveProperty('code');
  });

  it('shows the outgoing call that reaches nothing, and counts it', async () => {
    const flow = await call('get_flow', {
      entry: 'entry:gateway:http:POST:/orders/:param/cancel',
      detail: 2,
    });
    const dead = flatten(flow.root).find((item) => item.node.type === 'http_out');
    expect(dead?.node.meta?.['targetService']).toBe('orders');
    expect(flow.unresolvedOnPath).toBeGreaterThan(0);
  });
});

describe('working backwards', () => {
  it('finds the caller in another repository', async () => {
    const answer = await call('who_calls', {
      symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne',
      depth: 6,
    });
    const seen = new Set<string>();
    const walk = (nodes: FlowNode[]): void => {
      for (const item of nodes) {
        seen.add(item.node.id);
        walk(item.children);
      }
    };
    walk(answer.callers);
    expect(seen).toContain('entry:orders:http:GET:/orders/:param');
    expect(seen).toContain(
      requestIn('gateway#src/clients/orders.client.ts:OrdersClient.fetchOne'),
    );
  });

  it('names every entry that can reach a symbol, and whose they are', async () => {
    const answer = await call('impact', {
      symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne',
    });
    expect(answer.entries.map((entry: { id: string }) => entry.id)).toEqual([
      'entry:gateway:http:GET:/orders/:param',
      'entry:orders:http:GET:/orders/:param',
    ]);
    expect(answer.entriesByService).toEqual({ gateway: 1, orders: 1 });
    // Every service the chain runs into, whether or not a way in was found
    // above it, because a change is visible in all of them (R03).
    expect(Object.keys(answer.reachedByService).sort()).toEqual(['gateway', 'orders', 'web']);
    expect(answer.servicesWithoutEntry).toEqual(['web']);
  });

  it('answers what would break if a table changed', () => {
    // A table, a channel and a setting were all dead ends to the reverse walk,
    // so this used to return nothing at all (R03).
    return call('impact', { symbol: 'table:orders#orders' }).then((answer) => {
      expect(answer.reached).toBeGreaterThan(0);
      expect(answer.entries.length).toBeGreaterThan(0);
    });
  });

  it('says how much reaches a symbol even when no entry does', async () => {
    const answer = await call('impact', {
      symbol: 'gateway#src/clients/orders.client.ts:OrdersClient.fetchOne',
    });
    expect(answer.reached).toBeGreaterThan(0);
  });

  it('offers candidates rather than picking one', async () => {
    const answer = await call('who_calls', { symbol: 'findOne' });
    expect(answer.candidates.length).toBeGreaterThan(1);
  });

  it('asks the same tool again once per candidate (P94)', async () => {
    const answer = await call('who_calls', { symbol: 'findOne' });
    expect(answer.next).toEqual(
      answer.candidates.slice(0, 4).map((candidate: { id: string }) => `who_calls({symbol: ${JSON.stringify(candidate.id)}})`),
    );
    const impact = await call('impact', { symbol: 'findOne' });
    expect(impact.next.every((hint: string) => hint.startsWith('impact('))).toBe(true);
  });

  it('counts the callers it left past its depth, and names the rows to ask on from (P94)', async () => {
    const answer = await call('who_calls', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne', depth: 2 });
    expect(answer.truncated).toBe('1 more nodes past depth 2; raise depth');
    expect(answer.stoppedBy).toEqual(['depth']);
    expect(answer.frontier).toEqual(['entry:orders:http:GET:/orders/:param']);
    expect(answer.next[0]).toBe('who_calls({symbol: "orders#src/orders/orders.service.ts:OrdersService.findOne", depth: 4})');
  });

  it('says nothing was cut when the walk ran out of callers', async () => {
    const answer = await call('who_calls', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne', depth: 16 });
    expect(answer.truncated).toBeUndefined();
    expect(answer.stoppedBy).toBeUndefined();
  });

  it('takes a route said with a real value, and gives the two services that serve it as candidates (P94)', async () => {
    const answer = await call('who_calls', { symbol: 'GET /orders/123' });
    expect(answer.candidates.map((candidate: { id: string }) => candidate.id)).toEqual([
      'entry:gateway:http:GET:/orders/:param',
      'entry:orders:http:GET:/orders/:param',
    ]);
  });

  it('takes a literal route, and names the routes that answer it less specifically (P94)', async () => {
    const answer = await call('impact', { symbol: 'GET /orders/latest' });
    expect(answer.target.id).toBe('entry:orders:http:GET:/orders/latest');
    expect(answer.alsoAnswers).toEqual(['entry:gateway:http:GET:/orders/:param', 'entry:orders:http:GET:/orders/:param']);
  });
});

describe('channels', () => {
  it('takes a channel name with or without its prefix', async () => {
    const bare = await call('who_emits', { channel: 'order.created' });
    const prefixed = await call('who_emits', { channel: 'channel:order.created' });
    expect(bare).toEqual(prefixed);
    expect(bare.producers).toHaveLength(1);
  });

  it('finds the handler in another repository', async () => {
    const answer = await call('who_consumes', { channel: 'order.created' });
    expect(answer.consumers[0].service).toBe('billing');
  });

  it('answers with an empty list when nothing handles a channel', async () => {
    const answer = await call('who_consumes', { channel: 'order.archived' });
    expect(answer.consumers).toEqual([]);
    expect(answer.error).toBeUndefined();
  });

  it('says so when the channel does not exist', async () => {
    expect((await call('who_emits', { channel: 'nope' })).error).toContain('no channel named');
  });

  it('names the nearest channels when the one asked for does not exist (P94)', async () => {
    const answer = await call('who_consumes', { channel: 'order.creatd' });
    expect(answer.suggestions.map((node: { id: string }) => node.id)).toContain('channel:order.created');
    expect(answer.next[0]).toBe('who_consumes({channel: "channel:order.created"})');
  });
});

describe('types', () => {
  it('reads a type by its full id', async () => {
    const answer = await call('get_type', { type: 'type:@fx/contracts#OrderDto', detail: 2 });
    expect(answer.type.name).toBe('OrderDto');
    expect(answer.type.meta.sharedPackage).toBe('@fx/contracts');
  });

  it('reads a type by its bare name', async () => {
    const answer = await call('get_type', { type: 'CreateOrderDto' });
    expect(answer.type.id).toBe('type:@fx/contracts#CreateOrderDto');
  });

  it('offers the choices when a name means two types', async () => {
    const answer = await call('get_type', { type: 'InvoiceDto' });
    expect(answer.candidates).toEqual(['type:billing#InvoiceDto', 'type:gateway#InvoiceDto']);
  });

  it('expands what a type refers to', async () => {
    const answer = await call('get_type', { type: 'type:@fx/contracts#OrderDto', depth: 3 });
    expect(Object.keys(answer.nested)).toContain('type:@fx/contracts#Money');
  });
});

describe('whether two services still agree', () => {
  it('says a shared declaration cannot drift', async () => {
    const answer = await call('check_contract', {
      from: requestIn('gateway#src/clients/orders.client.ts:OrdersClient.fetchOne'),
      to: 'entry:orders:http:GET:/orders/:param',
    });
    expect(answer.response.status).toBe('shared');
    expect(answer.response.left).toBe('type:@fx/contracts#OrderDto');
  });

  it('says when each side declares its own shape and they differ', async () => {
    const answer = await call('check_contract', {
      edge: `${requestIn('gateway#src/clients/billing.client.ts:BillingClient.requestInvoice')} -http_calls-> entry:billing:http:POST:/invoices`,
    });
    expect(answer.response.status).toBe('hash_differs');
    expect(answer.response.left).toBe('type:gateway#InvoiceDto');
    expect(answer.response.right).toBe('type:billing#InvoiceDto');
    expect(answer.status).toBe('hash_differs');
  });

  it('says when a side named no type rather than pretending to check', async () => {
    const answer = await call('check_contract', {
      from: requestIn('gateway#src/clients/billing.client.ts:BillingClient.requestInvoice'),
      to: 'entry:billing:http:POST:/invoices',
    });
    expect(answer.request.status).toBe('unchecked');
    expect(answer.request.note).toContain('declares no named type');
  });

  it('says so when there is no such edge', async () => {
    const answer = await call('check_contract', { from: 'a', to: 'b' });
    expect(answer.error).toContain('no edge');
  });

  it('lists every crossing between two services, each with the call that checks it (P94)', async () => {
    const answer = await call('check_contract', { from: 'gateway', to: 'billing' });
    expect(answer.crossings.map((crossing: { to: string }) => crossing.to)).toEqual(['entry:billing:http:POST:/invoices']);
    expect(answer.crossings[0]).toMatchObject({ type: 'http_calls', status: 'hash_differs' });
    expect(answer.next[0]).toBe(answer.crossings[0].check);
    const publishes = await call('check_contract', { from: 'orders', to: 'billing' });
    expect(publishes.crossings).toEqual([
      expect.objectContaining({ type: 'emits', via: 'channel:order.created', to: expect.stringContaining('InvoicesConsumer.onOrderCreated') }),
    ]);
  });

  it('says when nothing crosses between two services, and which way something does', async () => {
    const answer = await call('check_contract', { from: 'billing', to: 'gateway' });
    expect(answer.crossings).toEqual([]);
    expect(answer.note).toBe('nothing crosses from billing to gateway; 1 crossing(s) go the other way');
    expect(answer.next).toEqual(['check_contract({from: "gateway", to: "billing"})']);
  });
});

describe('reading the code itself', () => {
  it('returns the real source of a symbol', async () => {
    const answer = await call('get_source', {
      symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne',
    });
    expect(answer.file).toBe('src/orders/orders.service.ts');
    expect(answer.code).toContain('findOne');
    expect(answer.endLine).toBeGreaterThanOrEqual(answer.line);
  });

  it('widens the window when asked', async () => {
    const tight = await call('get_source', {
      symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne',
    });
    const wide = await call('get_source', {
      symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne',
      context: 3,
    });
    expect(wide.code.length).toBeGreaterThan(tight.code.length);
  });

  it('says so when the symbol is unknown, and names the nearest (P94)', async () => {
    const answer = await call('get_source', { symbol: 'OrdersServce.findOne' });
    expect(answer.error).toContain('no symbol matches');
    expect(answer.suggestions[0].id).toBe('orders#src/orders/orders.service.ts:OrdersService.findOne');
    expect(answer.next[0]).toBe('get_source({symbol: "orders#src/orders/orders.service.ts:OrdersService.findOne"})');
  });

  it('takes a name, not only an id (P94)', async () => {
    const answer = await call('get_source', { symbol: 'OrdersService.create' });
    expect(answer.id).toBe('orders#src/orders/orders.service.ts:OrdersService.create');
    expect(answer.code).toContain('create');
  });

  it('gives the candidates, each a get_source call, for a name that means more than one', async () => {
    const answer = await call('get_source', { symbol: 'findOne' });
    expect(answer.candidates.length).toBeGreaterThan(1);
    expect(answer.next.every((hint: string) => hint.startsWith('get_source('))).toBe(true);
  });
});

describe('an answer that could not be given (P94)', () => {
  it('is a failed call every time, never an empty result', async () => {
    const failing: Array<[string, Record<string, unknown>]> = [
      ['who_calls', { symbol: 'zzzz-nothing-zzzz' }],
      ['impact', { symbol: 'zzzz-nothing-zzzz' }],
      ['who_emits', { channel: 'nope' }],
      ['get_source', { symbol: 'zzzz-nothing-zzzz' }],
      ['get_flow', { entry: 'PUT /nowhere' }],
      ['check_contract', { from: 'a', to: 'b' }],
      ['cant_follow', { cause: 'no-such-cause' }],
      ['search', { query: 'zzzz-nothing-zzzz' }],
    ];
    for (const [name, args] of failing) {
      const reply = (await client.callTool({ name, arguments: args })) as { isError?: boolean; structuredContent?: unknown; content: Array<{ text: string }> };
      expect(reply.isError, name).toBe(true);
      expect(reply.structuredContent, name).toBeUndefined();
      expect(JSON.parse(reply.content[0]!.text).error, name).toEqual(expect.any(String));
    }
  });

  it('names the causes there are when the one asked for does not exist', async () => {
    const answer = await call('cant_follow', { cause: 'nope' });
    expect(answer.error).toBe('no cause named "nope"');
    expect(answer.known).toEqual(expect.arrayContaining(['module-not-installed', 'target-route-not-found']));
    const near = await call('cant_follow', { cause: 'api-path-dynamik' });
    expect(near.nearest).toEqual(['api-path-dynamic']);
  });

  it('says why a finding asked for as a cause has nothing to follow', async () => {
    const answer = await call('cant_follow', { cause: 'route-unguarded' });
    expect(answer.error).toBeUndefined();
    expect(answer.causes).toEqual([]);
    expect(answer.note).toBe('route-unguarded is a finding, not a step the reader missed: 4 rows');
    expect(answer.next).toEqual(['search({query: "route-unguarded", kinds: ["gaps"]})']);
  });

  it('says a known cause has no rows in the service asked about', async () => {
    const answer = await call('cant_follow', { cause: 'api-path-dynamic', service: 'gateway' });
    expect(answer.note).toBe('no api-path-dynamic rows in gateway');
    expect(answer.next).toEqual(['cant_follow({cause: "api-path-dynamic"})']);
  });
});

describe('answers that hand on the id the next question needs', () => {
  it('starts a session with counts, gaps and ids that get_flow takes as they are', async () => {
    const start = await call('start_here');
    expect(start.services.map((row: { service: string }) => row.service)).toEqual(['billing', 'gateway', 'orders', 'web']);
    expect(start.channels.noConsumers).toEqual(['channel:order.archived']);
    expect(start.channels.noProducers).toEqual(['channel:invoice.requested']);
    expect(start.topGaps.length).toBeGreaterThan(0);
    expect(start.topGaps.length).toBeLessThanOrEqual(5);
    for (const service of ['billing', 'gateway', 'orders']) {
      expect(start.startFrom.filter((row: { service: string }) => row.service === service).length).toBeLessThanOrEqual(3);
    }
    const flow = await call('get_flow', { entry: start.startFrom[0].id });
    expect(flow.root.node.id).toBe(start.startFrom[0].id);
    expect(start.next[0]).toBe(`get_flow({entry: ${JSON.stringify(start.startFrom[0].id)}})`);
  });

  it('narrows start_here to one service', async () => {
    const start = await call('start_here', { service: 'billing' });
    expect(start.services.map((row: { service: string }) => row.service)).toEqual(['billing']);
    expect(start.startFrom.every((row: { service: string }) => row.service === 'billing')).toBe(true);
    expect(start.channels.noConsumers).toEqual([]);
  });

  it('ends a list with the call that takes its first id', async () => {
    const listed = await call('list_entries', { service: 'billing' });
    expect(listed.next[0]).toBe(`get_flow({entry: ${JSON.stringify(listed.entries[0].id)}})`);
    const channel = await call('who_consumes', { channel: 'order.created' });
    expect(channel.next[0]).toBe('who_emits({channel: "channel:order.created"})');
    const handler = await call('who_calls', { symbol: channel.consumers[0].id });
    expect(handler.target.id).toBe(channel.consumers[0].id);
  });

  it('takes the same service filter on every list tool', async () => {
    const callers = await call('who_calls', {
      symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne',
      depth: 6,
      service: 'gateway',
    });
    const services = new Set<string>();
    // A row under a parent of its own service leaves `service` to the parent (P93).
    const walk = (nodes: FlowNode[], parent: string | undefined): void => {
      for (const item of nodes) {
        const own = item.node.service ?? parent;
        if (item.children.length === 0) services.add(String(own));
        walk(item.children, own);
      }
    };
    walk(callers.callers, callers.target.service);
    expect([...services]).toEqual(['gateway']);
    const impact = await call('impact', { symbol: 'orders#src/orders/orders.service.ts:OrdersService.findOne', service: 'orders' });
    expect(impact.entries.map((entry: { id: string }) => entry.id)).toEqual(['entry:orders:http:GET:/orders/:param']);
    expect((await call('who_emits', { channel: 'order.created', service: 'billing' })).producers).toEqual([]);
  });

  it('describes an entry as bounded Markdown with places, shapes, gaps and ids', async () => {
    const answer = await call('describe_for_prompt', { id: 'entry:gateway:http:POST:/orders/:param/cancel' });
    expect(answer.id).toBe('entry:gateway:http:POST:/orders/:param/cancel');
    expect(answer.markdown).toMatch(/^# Way in: POST \/orders\/:param\/cancel/);
    expect(answer.markdown).toContain('## Steps');
    expect(answer.markdown).toMatch(/`src\/[^`]+:\d+`/);
    expect(answer.markdown).toContain('`target-route-not-found`');
    expect(answer.markdown).toContain('## Ask next');
    expect(answer.next[0]).toContain('get_flow');
  });

  it('describes a channel with what publishes onto it', async () => {
    const answer = await call('describe_for_prompt', { id: 'order.created' });
    expect(answer.id).toBe('channel:order.created');
    expect(answer.markdown).toContain('## Published by · 1');
    expect(answer.markdown).toContain('## Consumed by · 1');
  });

  it('describes a check by its gap id, every row of it at its line (P97)', async () => {
    const id = 'gap:web|src/app/orders-api.service.ts|api-path-dynamic';
    const answer = await call('describe_for_prompt', { id });
    expect(answer.id).toBe(id);
    expect(answer.markdown).toMatch(/^# Check: api-path-dynamic/);
    expect(answer.markdown).toContain('## Where · 3');
    expect(answer.next).toEqual(['search({query: "src/app/orders-api.service.ts", kinds: ["gaps"]})']);
    expect((await call('describe_for_prompt', { id: 'gap:web|src/nowhere.ts|api-path-dynamic' })).error).toMatch(/no rows answer to/);
  });

  it('writes the text the shared prompt snapshots hold, which the page writes too (P97)', async () => {
    const dir = join(FIXTURE, 'expected.prompt');
    const asked = {
      'entry.md': 'entry:gateway:http:POST:/orders/:param/invoice',
      'channel.md': 'channel:order.created',
      'row.md': 'gap:web|src/app/orders-api.service.ts|api-path-dynamic',
    };
    for (const [file, id] of Object.entries(asked)) {
      expect((await call('describe_for_prompt', { id })).markdown).toBe(readFileSync(join(dir, file), 'utf8'));
    }
  });

  it('keeps the Markdown under the ceiling it was given', async () => {
    const answer = await call('describe_for_prompt', { id: 'entry:gateway:http:GET:/orders/:param', maxChars: 500 });
    expect(answer.markdown.length).toBeLessThanOrEqual(500);
    expect(answer.markdown).toContain('cut to stay under 500 characters');
  });
});
