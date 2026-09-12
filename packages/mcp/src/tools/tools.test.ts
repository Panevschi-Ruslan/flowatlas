import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';
import type { FlowNode } from '../query/types.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'multi-repo', 'flowatlas.config.json');

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
  it('are exactly the ten the project promises', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'check_contract',
      'find_symbol',
      'get_flow',
      'get_source',
      'get_type',
      'impact',
      'list_entries',
      'who_calls',
      'who_consumes',
      'who_emits',
    ]);
  });

  it('each describe what they are for', async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) expect(tool.description?.length ?? 0).toBeGreaterThan(40);
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
    expect(listed.truncated).toMatch(/^\d+ more nodes, increase depth or narrow scope$/);
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
    expect(ids).toContain('table:orders#Order');
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
    expect(flow.truncated).toMatch(/more nodes, increase depth or narrow scope$/);
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
    expect(seen).toContain('http_out:gateway#src/clients/orders.client.ts:33:12');
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
    return call('impact', { symbol: 'table:orders#Order' }).then((answer) => {
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
});

describe('types', () => {
  it('reads a type by its full id', async () => {
    const answer = await call('get_type', { type: 'type:@fx/contracts#OrderDto' });
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
      from: 'http_out:gateway#src/clients/orders.client.ts:33:12',
      to: 'entry:orders:http:GET:/orders/:param',
    });
    expect(answer.response.status).toBe('shared');
    expect(answer.response.left).toBe('type:@fx/contracts#OrderDto');
  });

  it('says when each side declares its own shape and they differ', async () => {
    const answer = await call('check_contract', {
      edge: 'http_out:gateway#src/clients/billing.client.ts:33:12 -http_calls-> entry:billing:http:POST:/invoices',
    });
    expect(answer.response.status).toBe('hash_differs');
    expect(answer.response.left).toBe('type:gateway#InvoiceDto');
    expect(answer.response.right).toBe('type:billing#InvoiceDto');
    expect(answer.status).toBe('hash_differs');
  });

  it('says when a side named no type rather than pretending to check', async () => {
    const answer = await call('check_contract', {
      from: 'http_out:gateway#src/clients/billing.client.ts:33:12',
      to: 'entry:billing:http:POST:/invoices',
    });
    expect(answer.request.status).toBe('unchecked');
    expect(answer.request.note).toContain('declares no named type');
  });

  it('says so when there is no such edge', async () => {
    const answer = await call('check_contract', { from: 'a', to: 'b' });
    expect(answer.error).toContain('no edge');
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

  it('says so when the symbol is unknown', async () => {
    expect((await call('get_source', { symbol: 'nope' })).error).toContain('no symbol with id');
  });
});
