import { accessOf, SCHEMA_VERSION, parseConfig, type FlowatlasConfig, type GraphNode, type RepoGraph } from '@flowatlas/core';
import { parseDocument, schemaOf, type GatewayRouteMeta, type GraphqlCallMeta, type MetaField } from '@flowatlas/graphql';
import { describe, expect, it } from 'vitest';
import { readGraphqlDocument } from './graphql/read.js';
import { linkGraphs } from './link.js';

/**
 * A gateway's subgraphs found by the port they listen on, plans through
 * entity interfaces and contexts, and the router's authorization directives
 * as checks in front of the fields they guard (P245).
 */

const FIXED = '2026-11-06T00:00:00.000Z';

const MEDIA = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.8", import: ["@key", "@requiresScopes"])
  type Query { media: [Media!]! }
  interface Media @key(fields: "id") { id: ID! title: String! }
  type Book implements Media @key(fields: "id") { id: ID! title: String! author: String! }
  type Movie implements Media @key(fields: "id") { id: ID! title: String! director: String! @requiresScopes(scopes: [["media:staff"]]) }
`;
const REVIEWS = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.8", import: ["@key", "@interfaceObject", "@authenticated"])
  type Query { topRated: [Media!]! }
  type Media @key(fields: "id") @interfaceObject { id: ID! reviews: [Review!]! rating: Float @authenticated }
  type Review { score: Int! }
`;
const ACCOUNTS = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.8", import: ["@key", "@context", "@fromContext"])
  type Query { me: User wishItem(id: ID!): WishItem }
  type User @key(fields: "id") @context(name: "viewer") { id: ID! currency: String! wishlist: [WishItem!]! }
  type WishItem { id: ID! price(currency: String @fromContext(field: "$viewer { currency }")): Float! }
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

/** A subgraph listening on a port, as its code says. */
const subgraph = (repo: string, text: string, port: number, fields: string[]): RepoGraph =>
  graph(repo, [
    endpoint(repo, { schema: schemaOf([parseDocument(text)]), subgraph: { federation: 2 }, listen: [{ port, file: 'src/main.ts', line: 7 }] }),
    ...fields.map((key) => field(repo, key, key.startsWith('Query.') ? {} : { field: true, ...(key.endsWith('__resolveReference') ? { reference: true } : {}) })),
  ]);

/** Selections as a request node keeps them, each at its own line from 10. */
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
  graph('bff', [{ id: 'http_out:bff#src/client.ts:9:1', type: 'http_out', label: 'query', repo: 'bff', file: 'src/client.ts', line: 9, meta: { method: 'POST', path: '/graphql', baseUrlEnv: 'GATEWAY_URL', graphql } }]);

const local = (name: string, port: number, line: number): GatewayRouteMeta => ({ name, file: 'src/main.ts', line, url: `http://localhost:${port}/graphql`, host: `localhost:${port}`, path: '/graphql' });

const ROUTES = [local('media', 4001, 3), local('reviews', 4002, 4), local('accounts', 4003, 5)];

const SERVICES = [
  { name: 'gateway', repo: './gateway', type: 'express', baseUrlEnv: ['GATEWAY_URL'] },
  { name: 'media', repo: './media', type: 'express' },
  { name: 'reviews', repo: './reviews', type: 'express' },
  { name: 'accounts', repo: './accounts', type: 'express' },
  { name: 'bff', repo: './bff', type: 'express' },
];

const SUBGRAPHS = (): RepoGraph[] => [
  subgraph('media', MEDIA, 4001, ['Query.media', 'Media.__resolveReference', 'Movie.director']),
  subgraph('reviews', REVIEWS, 4002, ['Query.topRated', 'Media.__resolveReference', 'Media.reviews', 'Media.rating']),
  subgraph('accounts', ACCOUNTS, 4003, ['Query.me', 'Query.wishItem', 'User.wishlist', 'WishItem.price']),
];

const project = (graphql: GraphqlCallMeta, gateway: RepoGraph = graph('gateway', [endpoint('gateway', { gateway: { subgraphs: ROUTES } })]), more: RepoGraph[] = [], services = SERVICES) =>
  linkGraphs([gateway, ...SUBGRAPHS(), ...more, asking(graphql)], config(services), { builtAt: FIXED }).project;

const from = (joined: ReturnType<typeof project>, id: string) =>
  joined.edges
    .filter((edge) => edge.from === id && (edge.type === 'hits' || edge.type === 'http_calls'))
    .map((edge) => `${edge.to} ${edge.confidence} ${edge.line}`)
    .sort();

describe('subgraphs found by the port they listen on (P245)', () => {
  it('joins an address on this machine to the service whose server listens on its port, static, with no host configured', () => {
    const joined = project(operation('Media', 'media { id }'));
    expect(from(joined, 'entry:gateway:http:POST:/graphql')).toEqual([
      'entry:accounts:http:POST:/graphql static 5',
      'entry:media:http:POST:/graphql static 3',
      'entry:reviews:http:POST:/graphql static 4',
    ]);
    expect(joined.unresolved.filter((row) => row.reason === 'graphql-subgraph-not-joined')).toEqual([]);
  });

  it('says two services on one port, and lets a configured host decide', () => {
    const legacy = graph('legacy', [endpoint('legacy', { schema: schemaOf([parseDocument('type Query { stock: Int }')]), listen: [{ port: 4001, file: 'src/server.ts', line: 2 }] })]);
    const services = [...SERVICES, { name: 'legacy', repo: './legacy', type: 'express' }];
    const both = project(operation('Media', 'media { id }'), undefined, [legacy], services);
    const row = both.unresolved.find((each) => each.reason === 'graphql-subgraph-not-joined');
    expect(row?.message).toContain('port 4001 on this machine is where legacy (src/server.ts:2) and media (src/main.ts:7) each listen');
    const configured = project(operation('Media', 'media { id }'), undefined, [legacy], services.map((service) => (service.name === 'media' ? { ...service, hosts: ['localhost:4001'] } : service)));
    expect(configured.unresolved.filter((each) => each.reason === 'graphql-subgraph-not-joined')).toEqual([]);
    expect(from(configured, 'entry:gateway:http:POST:/graphql')).toContain('entry:media:http:POST:/graphql static 3');
  });
});

describe('a request through entity interfaces and contexts (P245)', () => {
  it('reaches the interface object\'s resolver for a field it adds, after its reference resolver', () => {
    const joined = project(operation('Shelf', 'media { title ... on Book { rating } }'));
    expect(from(joined, 'http_out:bff#src/client.ts:9:1')).toEqual([
      'entry:gateway:http:POST:/graphql static 9',
      'entry:media:graphql:Query.media static 10',
      'entry:reviews:graphql:Media.__resolveReference static 12',
      'entry:reviews:graphql:Media.rating static 12',
    ]);
    const rating = joined.edges.find((edge) => edge.to === 'entry:reviews:graphql:Media.rating');
    expect(rating?.meta).toEqual({ graphql: { operation: 'Shelf', gateway: 'gateway', subgraph: 'reviews', field: 'Book.rating', as: 'Media', hop: { entity: 'Media', from: 'media' } }, through: 'gateway' });
  });

  it('asks the interface\'s owner which type a value is, from the interface object', () => {
    const joined = project(operation('Top', 'topRated { ... on Movie { director } }'));
    expect(from(joined, 'http_out:bff#src/client.ts:9:1')).toEqual([
      'entry:gateway:http:POST:/graphql static 9',
      'entry:media:graphql:Media.__resolveReference static 11',
      'entry:media:graphql:Movie.director static 11',
      'entry:reviews:graphql:Query.topRated static 10',
    ]);
  });

  it('says an argument a context fills where nothing above the field sets the context', () => {
    const under = project(operation('Wishlist', 'me { wishlist { price } }'));
    expect(under.unresolved.filter((row) => row.reason === 'graphql-context-not-reached')).toEqual([]);
    const alone = project(operation('Item', 'wishItem { price }'));
    expect(alone.unresolved.filter((row) => row.reason === 'graphql-context-not-reached').map((row) => [row.service, row.line, row.level, row.meta])).toEqual([
      ['bff', 11, 'info', { field: 'WishItem.price', argument: 'currency', context: 'viewer' }],
    ]);
  });
});

const SUPERGRAPH = `
schema
  @link(url: "https://specs.apollo.dev/link/v1.0")
  @link(url: "https://specs.apollo.dev/join/v0.5", for: EXECUTION)
  @link(url: "https://specs.apollo.dev/authenticated/v0.1", for: SECURITY)
  @link(url: "https://specs.apollo.dev/requiresScopes/v0.1", for: SECURITY)
{ query: Query }

enum join__Graph {
  MEDIA @join__graph(name: "media", url: "http://localhost:4001/graphql")
  REVIEWS @join__graph(name: "reviews", url: "http://localhost:4002/graphql")
}

type Query @join__type(graph: MEDIA) @join__type(graph: REVIEWS) {
  media: [Media!]! @join__field(graph: MEDIA)
  topRated: [Media!]! @join__field(graph: REVIEWS)
}

interface Media @join__type(graph: MEDIA, key: "id") @join__type(graph: REVIEWS, key: "id", isInterfaceObject: true) {
  id: ID!
  title: String! @join__field(graph: MEDIA)
  reviews: [Review!]! @join__field(graph: REVIEWS)
  rating: Float @join__field(graph: REVIEWS) @authenticated
}

type Book implements Media @join__implements(graph: MEDIA, interface: "Media") @join__type(graph: MEDIA, key: "id") {
  id: ID!
  title: String!
  author: String!
  reviews: [Review!]! @join__field
  rating: Float @join__field @authenticated
}

type Movie implements Media @join__implements(graph: MEDIA, interface: "Media") @join__type(graph: MEDIA, key: "id") {
  id: ID!
  title: String!
  director: String! @requiresScopes(scopes: [["media:staff"]])
  reviews: [Review!]! @join__field
  rating: Float @join__field @authenticated
}

type Review @join__type(graph: REVIEWS) { score: Int! }
`;

describe('the router\'s authorization directives (P245)', () => {
  const router = (): RepoGraph => readGraphqlDocument(SUPERGRAPH, { service: 'gateway', documentPath: 'router/supergraph.graphql' }).graph;

  it('draws each as a check of the router in front of the subgraph entries that resolve the field, on the entry\'s access too', () => {
    const joined = project(operation('Top', 'topRated { rating }'), router());
    const guards = joined.edges.filter((edge) => edge.type === 'guarded_by').map((edge) => `${edge.from} -> ${edge.to} ${edge.confidence}`);
    expect(guards).toEqual([
      'entry:media:graphql:Movie.director -> gateway#router/supergraph.graphql:@requiresScopes(media:staff) declared',
      'entry:reviews:graphql:Media.rating -> gateway#router/supergraph.graphql:@authenticated declared',
    ]);
    const check = joined.nodes.find((node) => node.id === 'gateway#router/supergraph.graphql:@authenticated');
    expect([check?.type, check?.label, check?.repo, check?.kind]).toEqual(['guard', '@authenticated', 'gateway', 'directive']);
    const rating = joined.nodes.find((node) => node.id === 'entry:reviews:graphql:Media.rating');
    expect(accessOf(rating)?.guards.map((guard) => [guard.name, guard.where, guard.via])).toEqual([['@authenticated', 'route', '@authenticated on Media.rating, checked by gateway']]);
    expect(joined.unresolved.filter((row) => row.reason === 'graphql-auth-not-checked')).toEqual([]);
    // The router checks the requests that come through it: the edge says so.
    expect(joined.edges.find((edge) => edge.type === 'guarded_by')?.meta?.['through']).toBe('gateway');
  });

  it('says a gateway in code composes them and checks none', () => {
    const joined = project(operation('Top', 'topRated { rating }'));
    expect(joined.edges.filter((edge) => edge.type === 'guarded_by')).toEqual([]);
    const row = joined.unresolved.find((each) => each.reason === 'graphql-auth-not-checked');
    expect([row?.service, row?.level, row?.meta]).toEqual(['gateway', 'action', { fields: ['Media.rating @authenticated', 'Movie.director @requiresScopes(media:staff)'] }]);
  });
});
