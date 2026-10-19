import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFlowatlasServer } from '../server.js';
import type { WireFlowNode } from '../query/wire.js';

/**
 * `get_flow` on a project whose every method logs, counts and reads through a
 * shared repository helper (P92). Walked once per caller, that plumbing filled
 * the budget before the request reached the service it ends in; these are the
 * two flows the ticket names, asked with no options at all.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'multi-repo-plumbing', 'flowatlas.config.json');

let client: Client;

const getFlow = async (entry: string): Promise<any> => {
  const response = (await client.callTool({ name: 'get_flow', arguments: { entry } })) as { content: Array<{ text: string }> };
  return JSON.parse(response.content[0]!.text);
};

const rows = (node: WireFlowNode): WireFlowNode[] => [node, ...node.children.flatMap(rows)];

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

describe('a flow through plumbing every method shares', () => {
  it('reaches the consumer in billing from POST /orders', async () => {
    const flow = await getFlow('POST /orders');
    const ids = rows(flow.root).map((row) => row.node.id);
    expect(ids).toContain('consumer:billing#src/invoices/invoices.consumer.ts:InvoicesConsumer.onOrderCreated');
    expect(ids).toContain('billing#src/invoices/invoices.service.ts:InvoicesService.create');
  });

  it("reaches billing's POST /invoices from the gateway's POST /orders/:param/invoice", async () => {
    const flow = await getFlow('POST /orders/:param/invoice');
    const ids = rows(flow.root).map((row) => row.node.id);
    expect(ids).toContain('entry:billing:http:POST:/invoices');
    expect(ids).toContain('billing#src/invoices/invoices.controller.ts:InvoicesController.create');
  });

  it('writes the logger out once and points at it from every other caller', async () => {
    const flow = await getFlow('POST /orders');
    const logger = rows(flow.root).filter((row) => row.node.id === 'orders#src/common/app-logger.ts:AppLogger.log');
    expect(logger.filter((row) => !('ref' in row.node))).toHaveLength(1);
    expect(logger.length).toBeGreaterThan(3);
    for (const row of logger.filter((item) => 'ref' in item.node)) {
      expect(row.node).toEqual({ id: 'orders#src/common/app-logger.ts:AppLogger.log', ref: true, seenAt: 'orders#src/orders/orders.controller.ts:OrdersController.create' });
    }
  });

  it('expands no node twice, and stays within its own ceilings', async () => {
    for (const entry of ['POST /orders', 'POST /orders/:param/invoice']) {
      const flow = await getFlow(entry);
      const own = rows(flow.root).filter((row) => !('ref' in row.node)).map((row) => row.node.id);
      expect(new Set(own).size).toBe(own.length);
      expect(rows(flow.root).length).toBeLessThanOrEqual(60);
      expect(JSON.stringify(flow).length).toBeLessThan(12000);
    }
  });
});
