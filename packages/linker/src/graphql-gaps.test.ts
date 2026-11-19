import { accessOf, SCHEMA_VERSION, parseConfig, type FlowatlasConfig, type GraphNode, type RepoGraph } from '@flowatlas/core';
import { parseDocument, schemaOf, type GraphqlCallMeta, type MetaField } from '@flowatlas/graphql';
import { describe, expect, it } from 'vitest';
import { readGraphqlDocument } from './graphql/read.js';
import { linkGraphs } from './link.js';

/**
 * The router's check on a field no resolver of its own answers, hung on the
 * resolver that does, for that field only; `@inaccessible` with the router's
 * directives; and an entity interface whose owner can say no concrete type
 * of it (P252).
 */

const FIXED = '2026-11-07T00:00:00.000Z';

const CATALOG = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.8", import: ["@key", "@authenticated", "@requiresScopes", "@inaccessible"])
  type Query { book(id: ID!): Book products: [Product!]! }
  interface Product @key(fields: "id") { id: ID! name: String! }
  type Book implements Product @key(fields: "id") {
    id: ID!
    name: String!
    price: Float! @authenticated
    cost: Float! @inaccessible @authenticated
    details: Details!
  }
  type Details { edition: Edition! }
  type Edition { year: Int! @requiresScopes(scopes: [["catalog:staff"]]) }
`;
const REVIEWS = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.8", import: ["@key", "@interfaceObject"])
  type Query { topProducts: [Product!]! }
  type Product @key(fields: "id") @interfaceObject { id: ID! reviews: [Review!]! }
  type Review { score: Int! }
`;

const SUPERGRAPH = `
schema
  @link(url: "https://specs.apollo.dev/link/v1.0")
  @link(url: "https://specs.apollo.dev/join/v0.5", for: EXECUTION)
  @link(url: "https://specs.apollo.dev/inaccessible/v0.2", for: SECURITY)
  @link(url: "https://specs.apollo.dev/authenticated/v0.1", for: SECURITY)
  @link(url: "https://specs.apollo.dev/requiresScopes/v0.1", for: SECURITY)
{ query: Query }

enum join__Graph {
  CATALOG @join__graph(name: "catalog", url: "http://localhost:4001/graphql")
  REVIEWS @join__graph(name: "reviews", url: "http://localhost:4002/graphql")
}

type Query @join__type(graph: CATALOG) @join__type(graph: REVIEWS) {
  book(id: ID!): Book @join__field(graph: CATALOG)
  products: [Product!]! @join__field(graph: CATALOG)
  topProducts: [Product!]! @join__field(graph: REVIEWS)
}

interface Product @join__type(graph: CATALOG, key: "id") @join__type(graph: REVIEWS, key: "id", isInterfaceObject: true) {
  id: ID!
  name: String! @join__field(graph: CATALOG)
  reviews: [Review!]! @join__field(graph: REVIEWS)
}

type Book implements Product @join__implements(graph: CATALOG, interface: "Product") @join__type(graph: CATALOG, key: "id") {
  id: ID!
  name: String!
  price: Float! @authenticated
  cost: Float! @inaccessible @authenticated
  details: Details!
  reviews: [Review!]! @join__field
}

type Details @join__type(graph: CATALOG) { edition: Edition! }
type Edition @join__type(graph: CATALOG) { year: Int! @requiresScopes(scopes: [["catalog:staff"]]) }
type Review @join__type(graph: REVIEWS) { score: Int! }
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

const subgraph = (repo: string, text: string, port: number, fields: string[], typeResolvers: string[] = []): RepoGraph =>
  graph(repo, [
    endpoint(repo, { schema: schemaOf([parseDocument(text)]), subgraph: { federation: 2, ...(typeResolvers.length === 0 ? {} : { typeResolvers }) }, listen: [{ port, file: 'src/main.ts', line: 7 }] }),
    ...fields.map((key) => field(repo, key)),
  ]);

const operation = (name: string, text: string): GraphqlCallMeta => {
  const [definition] = parseDocument(`{ ${text} }`).definitions;
  if (definition?.kind !== 'operation') throw new Error('not an operation');
  let line = 10;
  const walk = (selections: typeof definition.selections, on?: string): MetaField[] =>
    selections.flatMap((selection): MetaField[] => {
      if (selection.kind === 'inline') return walk(selection.selections, selection.on);
      if (selection.kind !== 'field') return [];
      const at = line++;
      return [{ field: selection.name, line: at, ...(on === undefined ? {} : { on }), ...(selection.selections.length === 0 ? {} : { selections: walk(selection.selections) }) }];
    });
  return { operation: 'query', name, fields: walk(definition.selections), variables: [], document: { file: 'src/client.ts', line: 9 }, library: 'graphql-request' };
};

const asking = (graphql: GraphqlCallMeta): RepoGraph =>
  graph('bff', [{ id: 'http_out:bff#src/client.ts:9:1', type: 'http_out', label: 'query', repo: 'bff', file: 'src/client.ts', line: 9, meta: { method: 'POST', path: '/', baseUrlEnv: 'ROUTER_URL', graphql } }]);

const SERVICES = [
  { name: 'router', baseUrlEnv: ['ROUTER_URL'], document: { kind: 'graphql', path: 'router/supergraph.graphql' } },
  { name: 'catalog', repo: './catalog', type: 'express' },
  { name: 'reviews', repo: './reviews', type: 'express' },
  { name: 'bff', repo: './bff', type: 'express' },
];

const router = (): RepoGraph => readGraphqlDocument(SUPERGRAPH, { service: 'router', documentPath: 'router/supergraph.graphql' }).graph;

/** Catalog writes no reference resolver for its entity interface, and no type resolver unless told to. */
const project = (graphql: GraphqlCallMeta, typeResolvers: string[] = []) =>
  linkGraphs(
    [
      router(),
      subgraph('catalog', CATALOG, 4001, ['Query.book', 'Query.products', 'Book.details'], typeResolvers),
      subgraph('reviews', REVIEWS, 4002, ['Query.topProducts', 'Product.__resolveReference', 'Product.reviews']),
      asking(graphql),
    ],
    config(SERVICES),
    { builtAt: FIXED },
  ).project;

const guards = (joined: ReturnType<typeof project>): string[] =>
  joined.edges
    .filter((edge) => edge.type === 'guarded_by')
    .map((edge) => `${edge.from} -> ${edge.to.replace(/^.*supergraph\.graphql:/, '')}${Array.isArray(edge.meta?.['for']) ? ` for ${(edge.meta['for'] as string[]).join(',')}` : ''}`)
    .sort();

describe('a check on a field no resolver of its own answers (P252)', () => {
  it('hangs on the resolvers that answer it - the parent\'s, up through fields with none - for that field only', () => {
    const joined = project(operation('Book', 'book { price details { edition { year } } }'));
    expect(guards(joined)).toEqual([
      'entry:catalog:graphql:Book.details -> @requiresScopes(catalog:staff) for Edition.year',
      'entry:catalog:graphql:Query.book -> @authenticated for Book.price',
      // A list of the interface answers a book's price as well.
      'entry:catalog:graphql:Query.products -> @authenticated for Book.price',
    ]);
    const book = joined.nodes.find((node) => node.id === 'entry:catalog:graphql:Query.book');
    expect(accessOf(book)?.guards.map((guard) => [guard.name, guard.via, guard.for])).toEqual([
      ['@authenticated', '@authenticated on Book.price, which Query.book answers, checked by router', ['Book.price']],
    ]);
  });

  it('says on the request\'s step which guarded fields the entry answers for it', () => {
    const joined = project(operation('Book', 'book { price details { edition { year } } }'));
    const answers = (to: string) => joined.edges.find((edge) => edge.from === 'http_out:bff#src/client.ts:9:1' && edge.to === to)?.meta?.['answers'];
    expect(answers('entry:catalog:graphql:Query.book')).toEqual(['Book.price']);
    expect(answers('entry:catalog:graphql:Book.details')).toEqual(['Edition.year']);
    // A request that does not ask for the field carries nothing of it.
    const plain = project(operation('Name', 'book { name }'));
    expect(plain.edges.find((edge) => edge.to === 'entry:catalog:graphql:Query.book' && edge.from === 'http_out:bff#src/client.ts:9:1')?.meta?.['answers']).toBeUndefined();
  });

  it('draws no check for a field the router does not serve', () => {
    const joined = project(operation('Book', 'book { cost }'));
    expect(guards(joined).filter((guard) => guard.includes('Book.cost'))).toEqual([]);
    expect(joined.edges.find((edge) => edge.to === 'entry:catalog:graphql:Query.book')?.meta?.['answers']).toBeUndefined();
  });
});

describe('an entity interface its owner can say no type of (P252)', () => {
  it('is a row at the owner, and the entity call into it says untyped', () => {
    const joined = project(operation('Top', 'topProducts { ... on Book { details { edition { year } } } }'));
    const rows = joined.unresolved.filter((row) => row.reason === 'graphql-entity-type-unsaid');
    expect(rows.map((row) => [row.service, row.level, row.meta])).toEqual([['catalog', 'action', { interface: 'Product', subgraph: 'catalog', callers: ['reviews'] }]]);
    expect(rows[0]?.message).toContain('writes neither Product.__resolveReference nor a type resolver for it');
    const details = joined.edges.find((edge) => edge.to === 'entry:catalog:graphql:Book.details');
    expect((details?.meta?.['graphql'] as { hop?: unknown } | undefined)?.hop).toEqual({ entity: 'Product', from: 'reviews', untyped: true });
  });

  it('says nothing where the owner writes a type resolver for it', () => {
    const joined = project(operation('Top', 'topProducts { ... on Book { details { edition { year } } } }'), ['Product']);
    expect(joined.unresolved.filter((row) => row.reason === 'graphql-entity-type-unsaid')).toEqual([]);
    const details = joined.edges.find((edge) => edge.to === 'entry:catalog:graphql:Book.details');
    expect((details?.meta?.['graphql'] as { hop?: unknown } | undefined)?.hop).toEqual({ entity: 'Product', from: 'reviews' });
  });
});
