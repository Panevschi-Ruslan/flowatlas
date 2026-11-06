import { SCHEMA_VERSION, parseConfig, type FlowatlasConfig, type GraphNode, type RepoGraph } from '@flowatlas/core';
import { parseDocument, schemaOf, type GatewayRouteMeta, type GraphqlCallMeta, type SchemaSummary } from '@flowatlas/graphql';
import { describe, expect, it } from 'vitest';
import { readGraphqlDocument } from './graphql/read.js';
import { linkGraphs } from './link.js';

const FIXED = '2026-11-05T00:00:00.000Z';

const ORDERS = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable"])
  type Query { orders: [Order!]! regions: [String!]! @shareable }
  type Order @key(fields: "id") { id: ID! customer: Customer! }
  type Customer @key(fields: "id", resolvable: false) { id: ID! }
`;
const CUSTOMERS = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable"])
  type Query { customer(id: ID!): Customer regions: [String!]! @shareable }
  type Customer @key(fields: "id") { id: ID! email: String! }
`;

const config = (services: Array<Record<string, unknown>>): FlowatlasConfig => parseConfig({ services } as Parameters<typeof parseConfig>[0]);

const graph = (repo: string, nodes: GraphNode[]): RepoGraph => ({ schemaVersion: SCHEMA_VERSION, repo, generatedAt: FIXED, nodes, edges: [], types: {}, unresolved: [] });

const endpoint = (repo: string, graphql: Record<string, unknown>, path = '/graphql'): GraphNode => ({
  id: `entry:${repo}:http:POST:${path}`,
  type: 'entry',
  kind: 'http',
  label: `POST ${path}`,
  repo,
  file: 'src/main.ts',
  line: 1,
  meta: { method: 'POST', path, registration: 'graphql/endpoint', graphql: { endpoint: true, ...graphql } },
});

const field = (repo: string, key: string, meta: Record<string, unknown> = {}): GraphNode => ({
  id: `entry:${repo}:graphql:${key}`,
  type: 'entry',
  kind: 'graphql',
  label: key,
  repo,
  file: 'src/resolvers.ts',
  line: 1,
  meta: { type: key.split('.')[0], name: key.split('.')[1], ...meta },
});

const subgraph = (repo: string, schema: SchemaSummary, fields: GraphNode[]): RepoGraph => graph(repo, [endpoint(repo, { schema, subgraph: { federation: 2 } }), ...fields]);

const operation = (name: string, text: string): GraphqlCallMeta => {
  const [definition] = parseDocument(`{ ${text} }`).definitions;
  if (definition?.kind !== 'operation') throw new Error('not an operation');
  const walk = (selections: typeof definition.selections, line: number): GraphqlCallMeta['fields'] =>
    selections.flatMap((selection) => (selection.kind === 'field' ? [{ field: selection.name, line, ...(selection.selections.length === 0 ? {} : { selections: walk(selection.selections, line + 1) }) }] : []));
  return { operation: 'query', name, fields: walk(definition.selections, 10), variables: [], document: { file: 'src/client.ts', line: 9 }, library: 'graphql-request' };
};

/** A server asking the gateway one operation. */
const asking = (graphql: GraphqlCallMeta): RepoGraph =>
  graph('bff', [{ id: 'http_out:bff#src/client.ts:9:1', type: 'http_out', label: 'query', repo: 'bff', file: 'src/client.ts', line: 9, meta: { method: 'POST', path: '/graphql', baseUrlEnv: 'GATEWAY_URL', graphql } }]);

const gateway = (subgraphs: GatewayRouteMeta[]): RepoGraph => graph('gateway', [endpoint('gateway', { gateway: { subgraphs } })]);

const ROUTES: GatewayRouteMeta[] = [
  { name: 'orders', file: 'src/main.ts', line: 3, path: '', baseUrlEnv: 'ORDERS_URL' },
  { name: 'customers', file: 'src/main.ts', line: 4, url: 'http://customers:4002/graphql', host: 'customers:4002', path: '/graphql' },
];

const SERVICES = [
  { name: 'gateway', repo: './gateway', type: 'nestjs', baseUrlEnv: ['GATEWAY_URL'] },
  { name: 'orders', repo: './orders', type: 'express', baseUrlEnv: ['ORDERS_URL'] },
  { name: 'customers', repo: './customers', type: 'express' },
  { name: 'bff', repo: './bff', type: 'express' },
];

const project = (routes: GatewayRouteMeta[], graphql: GraphqlCallMeta) =>
  linkGraphs(
    [
      gateway(routes),
      subgraph('orders', schemaOf([parseDocument(ORDERS)]), [field('orders', 'Query.orders'), field('orders', 'Order.customer', { field: true }), field('orders', 'Query.regions')]),
      subgraph('customers', schemaOf([parseDocument(CUSTOMERS)]), [field('customers', 'Query.customer'), field('customers', 'Customer.__resolveReference', { field: true, reference: true }), field('customers', 'Query.regions')]),
      asking(graphql),
    ],
    config(SERVICES),
    { builtAt: FIXED },
  ).project;

const from = (graphOf: ReturnType<typeof project>, id: string) =>
  graphOf.edges.filter((edge) => edge.from === id && (edge.type === 'hits' || edge.type === 'http_calls')).map((edge) => [edge.to, edge.confidence, edge.line]);

describe('a federation gateway, joined (P241)', () => {
  it('joins each subgraph it names to a service, by its setting or its host, at the line that names it', () => {
    const joined = project(ROUTES, operation('Orders', 'orders { id }'));
    expect(from(joined, 'entry:gateway:http:POST:/graphql').sort((a, b) => Number(a[2]) - Number(b[2]))).toEqual([
      ['entry:orders:http:POST:/graphql', 'static', 3],
      ['entry:customers:http:POST:/graphql', 'static', 4],
    ]);
  });

  it('plans a request through it: each field to its owner, an entity hop to the owner\'s reference resolver', () => {
    const joined = project(ROUTES, operation('Orders', 'orders { id customer { id email } }'));
    expect(from(joined, 'http_out:bff#src/client.ts:9:1')).toEqual(
      expect.arrayContaining([
        ['entry:gateway:http:POST:/graphql', 'static', 9],
        ['entry:orders:graphql:Query.orders', 'static', 10],
        ['entry:orders:graphql:Order.customer', 'static', 11],
        ['entry:customers:graphql:Customer.__resolveReference', 'static', 12],
      ]),
    );
    const hop = joined.edges.find((edge) => edge.to === 'entry:customers:graphql:Customer.__resolveReference');
    expect(hop?.type).toBe('http_calls');
    expect(hop?.meta).toEqual({ graphql: { operation: 'Orders', gateway: 'gateway', subgraph: 'customers', field: 'Customer.__resolveReference', hop: { entity: 'Customer', from: 'orders', for: 'Customer.email' } } });
  });

  it('draws a shareable root field to every owner as a choice, and says so', () => {
    const joined = project(ROUTES, operation('Regions', 'regions'));
    expect(from(joined, 'http_out:bff#src/client.ts:9:1').filter(([to]) => String(to).endsWith('regions'))).toEqual([
      ['entry:customers:graphql:Query.regions', 'heuristic', 10],
      ['entry:orders:graphql:Query.regions', 'heuristic', 10],
    ]);
    expect(joined.unresolved.filter((row) => row.reason === 'graphql-shareable-choice').map((row) => [row.service, row.level])).toEqual([['bff', 'info']]);
  });

  it('says a subgraph whose address reaches nothing, and plans the rest as a guess', () => {
    const joined = project([...ROUTES, { name: 'reviews', file: 'src/main.ts', line: 5, url: 'http://reviews.internal/graphql', host: 'reviews.internal', path: '/graphql' }], operation('Orders', 'orders { id }'));
    expect(joined.unresolved.filter((row) => row.reason === 'graphql-subgraph-not-joined').map((row) => [row.service, row.line, row.level])).toEqual([['gateway', 5, 'action']]);
    expect(from(joined, 'http_out:bff#src/client.ts:9:1')).toContainEqual(['entry:orders:graphql:Query.orders', 'heuristic', 10]);
  });

  it('gives the gateway the composed schema, so the contract compares a selection with it', () => {
    const joined = project(ROUTES, operation('Orders', 'orders { id }'));
    const served = joined.nodes.find((node) => node.id === 'entry:gateway:http:POST:/graphql')?.meta?.['graphql'] as { schema?: SchemaSummary };
    expect(Object.keys(served.schema?.types['Query']?.fields ?? {}).sort()).toEqual(['customer', 'orders', 'regions']);
  });

  it('says a subgraph no gateway names, at its endpoint', () => {
    const joined = project([ROUTES[0] as GatewayRouteMeta], operation('Orders', 'orders { id }'));
    expect(joined.unresolved.filter((row) => row.reason === 'graphql-federation-not-read').map((row) => [row.service, row.symbol, row.meta])).toEqual([['customers', 'entry:customers:http:POST:/graphql', { detail: 'no-gateway' }]]);
  });
});

describe('a router declared by its files (P241, D11)', () => {
  const SUPERGRAPH = [
    'schema @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION) { query: Query }',
    'enum join__Graph {',
    '  ORDERS @join__graph(name: "orders", url: "http://orders:4001/graphql")',
    '}',
    'type Query @join__type(graph: ORDERS) { orders: [String!]! }',
  ].join('\n');

  it('reads a supergraph as the router\'s endpoint, with router.yaml\'s path and overrides', () => {
    const files: Record<string, string> = { 'router.yaml': 'supergraph:\n  path: /graphql\noverride_subgraph_url:\n  orders: ${env.ORDERS_URL}\n' };
    const { graph: read } = readGraphqlDocument(SUPERGRAPH, { service: 'router', documentPath: 'router/supergraph.graphql', readBeside: (path) => files[path] });
    const [entry] = read.nodes;
    expect(entry?.id).toBe('entry:router:http:POST:/graphql');
    const served = entry?.meta?.['graphql'] as { gateway: { subgraphs: GatewayRouteMeta[]; composition?: unknown } };
    expect(served.gateway.subgraphs).toEqual([{ name: 'orders', file: 'router/router.yaml', line: 4, path: '', baseUrlEnv: 'ORDERS_URL' }]);
    expect(served.gateway.composition).toBeDefined();
    expect(entry?.meta?.['declaredBy']).toBe('router/supergraph.graphql');
  });

  it('reads rover\'s configuration, a schema file it names composed beside the router', () => {
    const files: Record<string, string> = { 'customers.graphql': CUSTOMERS };
    const rover = 'subgraphs:\n  customers:\n    routing_url: http://customers:4002/graphql\n    schema:\n      file: ./customers.graphql\n  legacy:\n    routing_url: http://legacy/graphql\n    schema:\n      graphref: shop@current\n';
    const { graph: read } = readGraphqlDocument(rover, { service: 'router', documentPath: 'router/supergraph.yaml', readBeside: (path) => files[path.replace(/^\.\//, '')] });
    const served = read.nodes[0]?.meta?.['graphql'] as { gateway: { subgraphs: GatewayRouteMeta[] } };
    expect(served.gateway.subgraphs.map((route) => [route.name, route.line, route.schema !== undefined, route.registry])).toEqual([
      ['customers', 2, true, undefined],
      ['legacy', 6, false, 'shop@current'],
    ]);
    expect(read.nodes[0]?.id).toBe('entry:router:http:POST:/');
    expect(read.unresolved.map((row) => [row.reason, row.meta])).toEqual([['graphql-federation-not-read', { detail: 'registry' }]]);
  });
});
