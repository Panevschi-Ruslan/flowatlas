import { resolve } from 'node:path';
import { AdapterRegistry, type GraphNode, type RepoGraph } from '@flowatlas/core';
import { registerEntryAdapters } from '@flowatlas/adapters-entry';
import { extractRepo } from '@flowatlas/extractor-nestjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { procedureCallsPass } from './procedure-calls.js';

const WORKER = resolve(import.meta.dirname, '../../../fixtures/rpc-server-to-server/worker');

/** The procedures a NestJS worker asks two other services for (P242). */
describe("a server's oRPC and tRPC clients", () => {
  let graph: RepoGraph;
  beforeAll(async () => {
    graph = await extractRepo({
      rootDir: WORKER,
      repo: 'worker',
      registry: registerEntryAdapters(new AdapterRegistry()),
      extraPasses: [procedureCallsPass],
    });
  });

  const requests = (): GraphNode[] => graph.nodes.filter((node) => node.kind === 'rpc' && node.type === 'http_out');
  const requestFor = (procedure: string): GraphNode | undefined =>
    requests().find((node) => node.meta?.['procedure'] === procedure);

  it('is a request between services for each procedure, read from the clients a provider keeps', () => {
    expect(requests().map((node) => node.meta?.['procedure']).sort()).toEqual([
      'entries.record',
      'invoices.byOrder',
      'invoices.create',
      'invoices.paid',
      'invoices.refund',
      'orders.audit',
      'orders.get',
      'orders.get',
      'orders.list',
      'orders.place',
    ]);
    expect(requestFor('orders.place')?.meta?.['link']).toEqual({ protocol: 'rpc', path: '/rpc', baseUrlEnv: 'ORDERS_URL' });
    expect(requestFor('invoices.create')?.meta?.['link']).toEqual({ protocol: 'trpc', path: '/trpc', host: 'billing.internal' });
  });

  it('hangs each request off the method that makes it', () => {
    const place = requestFor('orders.place');
    expect(graph.edges.some((edge) => edge.to === place?.id && edge.from === 'worker#src/orders.client.ts:OrdersClient.place')).toBe(true);
  });

  it('takes back the rows about receivers the calls reader could not type', () => {
    expect(graph.unresolved.filter((row) => row.reason === 'call-dynamic-receiver')).toEqual([]);
  });

  it('says what it could not read: a socket, and a link whose address is worked out per request', () => {
    expect(graph.unresolved.map((row) => `${row.file}:${row.line} ${row.reason}`).sort()).toEqual([
      'src/billing.client.ts:36 procedure-link-socket',
      'src/refunds.ts:22 procedure-link-dynamic',
    ]);
  });
});
