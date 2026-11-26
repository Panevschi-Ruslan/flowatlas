import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ProjectGraph } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { readGraphqlDocument } from './read.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const fixture = (name: string): ProjectGraph => JSON.parse(readFileSync(join(ROOT, 'fixtures', name, 'expected.project-graph.json'), 'utf8')) as ProjectGraph;
const SDL = readFileSync(join(ROOT, 'fixtures', 'graphql-gateway', 'catalog', 'src', 'schema.graphql'), 'utf8');

describe('a GraphQL service declared by its schema (P232)', () => {
  it('has the root entries the server read from source has, declared by the document', () => {
    const { graph, declared } = readGraphqlDocument(SDL, { service: 'catalog', documentPath: 'catalog.graphql', generatedAt: '2026-11-05T00:00:00.000Z' });
    const roots = (nodes: readonly { type: string; kind?: string; id: string; meta?: Record<string, unknown> }[]) =>
      nodes.filter((node) => node.type === 'entry' && node.kind === 'graphql' && node.meta?.['field'] !== true).map((node) => node.id).sort();
    const fromSource = roots(fixture('graphql-gateway').nodes.filter((node) => node.repo === 'catalog'));
    expect(roots(graph.nodes)).toEqual(fromSource);
    expect(declared).toBe(fromSource.length);
    expect(graph.nodes.find((node) => node.id === 'entry:catalog:graphql:Query.product')).toMatchObject({ file: 'catalog.graphql', line: 3, meta: { declaredBy: 'catalog.graphql', returns: 'Product', args: { id: { type: 'ID!', required: true } } } });
  });

  it('reads an introspection result the same way', () => {
    const introspection = {
      data: {
        __schema: {
          queryType: { name: 'Query' },
          mutationType: null,
          subscriptionType: null,
          types: [
            { kind: 'OBJECT', name: 'Query', fields: [{ name: 'products', args: [], type: { kind: 'NON_NULL', ofType: { kind: 'LIST', ofType: { kind: 'OBJECT', name: 'Product' } } } }] },
            { kind: 'OBJECT', name: 'Product', fields: [{ name: 'id', args: [], type: { kind: 'SCALAR', name: 'ID' } }] },
            { kind: 'OBJECT', name: '__Type', fields: [] },
          ],
        },
      },
    };
    const { graph } = readGraphqlDocument(introspection, { service: 'catalog', documentPath: 'catalog.json' });
    expect(graph.nodes.filter((node) => node.kind === 'graphql').map((node) => [node.id, node.meta?.['returns']])).toEqual([['entry:catalog:graphql:Query.products', '[Product]!']]);
  });

  it('refuses a file that is neither, naming the line', () => {
    expect(() => readGraphqlDocument('type Query {\n  products: [Product!\n}', { service: 'catalog', documentPath: 'bad.graphql' })).toThrow(/bad\.graphql is not GraphQL SDL: .* at line 3/);
  });
});

describe('the fields a request selects, joined in the service it reached (P232)', () => {
  const graph = fixture('graphql-gateway');
  const edgesFrom = (from: string) => graph.edges.filter((edge) => edge.from === from && (edge.type === 'hits' || edge.type === 'http_calls'));

  it('joins the endpoint, then each root field and each field resolver under it, static, at the selection', () => {
    const orders = edgesFrom('ui_api_call:web#src/orders/OrdersPage.tsx:7:20');
    expect(orders.map((edge) => [edge.to, edge.confidence, edge.line])).toEqual(
      expect.arrayContaining([
        ['entry:orders:http:POST:/graphql', 'static', 7],
        ['entry:orders:graphql:Query.orders', 'static', 12],
        ['entry:orders:graphql:Order.customer', 'static', 14],
      ]),
    );
    expect(orders.find((edge) => edge.to.endsWith('Order.customer'))?.meta).toEqual({ graphql: { operation: 'Orders', field: 'Order.customer' } });
  });

  it('joins a server asking another server the same way, as http_calls', () => {
    expect(edgesFrom('http_out:catalog#src/orders-client.ts:14:22').map((edge) => [edge.type, edge.to])).toEqual(
      expect.arrayContaining([['http_calls', 'entry:orders:graphql:Query.orders']]),
    );
  });

  it('joins nothing for a document it could not read, and says so where it is', () => {
    expect(edgesFrom('ui_api_call:web#src/orders/Search.tsx:6:20').map((edge) => edge.to)).toEqual(['entry:orders:http:POST:/graphql']);
    expect(graph.unresolved.filter((row) => row.reason === 'graphql-document-dynamic').map((row) => [row.service, row.file, row.line])).toEqual([['web', 'src/orders/Search.tsx', 6]]);
  });
});
