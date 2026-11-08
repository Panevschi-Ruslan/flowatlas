import { SCHEMA_VERSION, parseConfig, type FlowatlasConfig, type GraphNode, type RepoGraph } from '@flowatlas/core';
import { parseDocument, schemaOf, type GraphqlCallMeta, type MetaField } from '@flowatlas/graphql';
import { describe, expect, it } from 'vitest';
import { readGraphqlDocument } from './graphql/read.js';
import { linkGraphs } from './link.js';

/**
 * The router's check on a field it fetches only for a `@requires` (P256).
 * The router checks its authorization directives on the client's operation;
 * a field it adds to the plan for a `@requires` is fetched unchecked, so no
 * check of the router stands in front of that step, and a requiring field
 * that does not carry what its required fields ask is a row.
 */

const FIXED = '2026-11-07T00:00:00.000Z';

const CATALOG = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key"])
  type Query { product(id: ID!): Product }
  type Product @key(fields: "id") { id: ID! name: String! }
`;
const INVENTORY = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key", "@authenticated"])
  type Product @key(fields: "id") { id: ID! weight: Int! @authenticated }
`;
const SHIPPING = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.9", import: ["@key", "@external", "@requires", "@authenticated"])
  type Product @key(fields: "id") {
    id: ID!
    weight: Int! @external
    estimate: Int! @requires(fields: "weight")
    fragile: Boolean! @requires(fields: "weight") @authenticated
  }
`;

const SUPERGRAPH = `
schema
  @link(url: "https://specs.apollo.dev/link/v1.0")
  @link(url: "https://specs.apollo.dev/join/v0.5", for: EXECUTION)
  @link(url: "https://specs.apollo.dev/authenticated/v0.1", for: SECURITY)
{ query: Query }

enum join__Graph {
  CATALOG @join__graph(name: "catalog", url: "http://localhost:4001/graphql")
  INVENTORY @join__graph(name: "inventory", url: "http://localhost:4002/graphql")
  SHIPPING @join__graph(name: "shipping", url: "http://localhost:4003/graphql")
}

type Query @join__type(graph: CATALOG) {
  product(id: ID!): Product @join__field(graph: CATALOG)
}

type Product @join__type(graph: CATALOG, key: "id") @join__type(graph: INVENTORY, key: "id") @join__type(graph: SHIPPING, key: "id") {
  id: ID!
  name: String! @join__field(graph: CATALOG)
  weight: Int! @join__field(graph: INVENTORY) @join__field(graph: SHIPPING, external: true) @authenticated
  estimate: Int! @join__field(graph: SHIPPING, requires: "weight")
  fragile: Boolean! @join__field(graph: SHIPPING, requires: "weight") @authenticated
}
`;

const config = (services: Array<Record<string, unknown>>): FlowatlasConfig => parseConfig({ services } as Parameters<typeof parseConfig>[0]);

const graph = (repo: string, nodes: GraphNode[]): RepoGraph => ({ schemaVersion: SCHEMA_VERSION, repo, generatedAt: FIXED, nodes, edges: [], types: {}, unresolved: [] });

const endpoint = (repo: string, graphql: Record<string, unknown>): GraphNode => ({
  id: `entry:${repo}:http:POST:/graphql`,
  type: 'entry',
  kind: 'http',
  label: 'POST /graphql',
  repo,
  file: 'src/main.ts',
  line: 1,
  meta: { method: 'POST', path: '/graphql', registration: 'graphql/endpoint', graphql: { endpoint: true, ...graphql } },
});

const field = (repo: string, key: string): GraphNode => ({
  id: `entry:${repo}:graphql:${key}`,
  type: 'entry',
  kind: 'graphql',
  label: key,
  repo,
  file: 'src/resolvers.ts',
  line: 1,
  meta: { type: key.split('.')[0], name: key.split('.')[1], ...(key.startsWith('Query.') ? {} : { field: true }), ...(key.endsWith('__resolveReference') ? { reference: true } : {}) },
});

const subgraph = (repo: string, text: string, port: number, fields: string[]): RepoGraph =>
  graph(repo, [
    endpoint(repo, { schema: schemaOf([parseDocument(text)]), subgraph: { federation: 2 }, listen: [{ port, file: 'src/main.ts', line: 7 }] }),
    ...fields.map((key) => field(repo, key)),
  ]);

const operation = (name: string, text: string): GraphqlCallMeta => {
  const [definition] = parseDocument(`{ ${text} }`).definitions;
  if (definition?.kind !== 'operation') throw new Error('not an operation');
  let line = 10;
  const walk = (selections: typeof definition.selections): MetaField[] =>
    selections.flatMap((selection): MetaField[] => {
      if (selection.kind !== 'field') return [];
      const at = line++;
      return [{ field: selection.name, line: at, ...(selection.selections.length === 0 ? {} : { selections: walk(selection.selections) }) }];
    });
  return { operation: 'query', name, fields: walk(definition.selections), variables: [], document: { file: 'src/client.ts', line: 9 }, library: 'graphql-request' };
};

const CALL = 'http_out:bff#src/client.ts:9:1';

const asking = (graphql: GraphqlCallMeta): RepoGraph =>
  graph('bff', [{ id: CALL, type: 'http_out', label: 'query', repo: 'bff', file: 'src/client.ts', line: 9, meta: { method: 'POST', path: '/', baseUrlEnv: 'ROUTER_URL', graphql } }]);

const SERVICES = [
  { name: 'router', baseUrlEnv: ['ROUTER_URL'], document: { kind: 'graphql', path: 'router/supergraph.graphql' } },
  { name: 'catalog', repo: './catalog', type: 'express' },
  { name: 'inventory', repo: './inventory', type: 'express' },
  { name: 'shipping', repo: './shipping', type: 'express' },
  { name: 'bff', repo: './bff', type: 'express' },
];

const project = (graphql: GraphqlCallMeta) =>
  linkGraphs(
    [
      readGraphqlDocument(SUPERGRAPH, { service: 'router', documentPath: 'router/supergraph.graphql' }).graph,
      subgraph('catalog', CATALOG, 4001, ['Query.product', 'Product.__resolveReference']),
      subgraph('inventory', INVENTORY, 4002, ['Product.__resolveReference', 'Product.weight']),
      subgraph('shipping', SHIPPING, 4003, ['Product.__resolveReference', 'Product.estimate', 'Product.fragile']),
      asking(graphql),
    ],
    config(SERVICES),
    { builtAt: FIXED },
  ).project;

const stepTo = (joined: ReturnType<typeof project>, to: string) => joined.edges.find((edge) => edge.from === CALL && edge.to === to);
const graphqlOf = (edge: { meta?: Record<string, unknown> } | undefined) => edge?.meta?.['graphql'] as Record<string, unknown> | undefined;

describe("the router's check on a field it fetches for a @requires (P256)", () => {
  it('says the step is a fetch for the requiring field, which the router does not check', () => {
    const joined = project(operation('Estimate', 'product(id: "p-1") { estimate }'));
    expect(graphqlOf(stepTo(joined, 'entry:inventory:graphql:Product.weight'))?.['requiredBy']).toBe('Product.estimate');
    // The check is still hung on the entry, for the requests that select the field.
    expect(joined.edges.some((edge) => edge.from === 'entry:inventory:graphql:Product.weight' && edge.type === 'guarded_by')).toBe(true);
  });

  it("draws an entry the client selects too by the client's selection", () => {
    const joined = project(operation('Both', 'product(id: "p-1") { estimate weight }'));
    expect(graphqlOf(stepTo(joined, 'entry:inventory:graphql:Product.weight'))?.['requiredBy']).toBeUndefined();
  });

  it('is a row where the requiring field does not carry what the fields it requires ask, and none where it does', () => {
    const joined = project(operation('Estimate', 'product(id: "p-1") { estimate }'));
    const rows = joined.unresolved.filter((row) => row.reason === 'graphql-requires-auth-not-carried');
    expect(rows.map((row) => [row.service, row.level, row.meta])).toEqual([
      ['router', 'action', { field: 'Product.estimate', subgraph: 'shipping', requires: 'weight', missing: ['@authenticated'] }],
    ]);
    expect(rows[0]?.message).toContain('does not carry @authenticated on Product.weight');
    expect(rows[0]?.message).toContain('the router checks the client\'s operation, not the fields it fetches for a @requires');
  });
});
