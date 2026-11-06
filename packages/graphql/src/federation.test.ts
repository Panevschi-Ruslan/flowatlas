import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { apiSchemaOf, composeSubgraphs, supergraphComposition, unreachableOwners, type Composition } from './federation.js';
import { addressOfText, readGraphqlGateway, readRouterConfig, readRoverConfig, routeAddress } from './gateway.js';
import type { MetaField } from './meta.js';
import { argumentOf, parseDocument, stringsOf } from './parse.js';
import { planSelection } from './plan.js';
import { schemaOf } from './schema.js';
import { readGraphqlServer } from './servers.js';

const sdl = (text: string) => schemaOf([parseDocument(text)]);

/** Selections as a request node keeps them, from a compact spelling: `orders { id customer { name } }`. */
const selected = (text: string): MetaField[] => {
  const [operation] = parseDocument(`{ ${text} }`).definitions;
  if (operation?.kind !== 'operation') throw new Error('not an operation');
  const walk = (selections: typeof operation.selections): MetaField[] =>
    selections.flatMap((selection) =>
      selection.kind === 'field' ? [{ field: selection.name, line: 1, ...(selection.selections.length === 0 ? {} : { selections: walk(selection.selections) }) }] : [],
    );
  return walk(operation.selections);
};

/** A plan, as `Type.field@subgraph` with the hop and the choice it makes. */
const planned = (composition: Composition, text: string): string[] =>
  planSelection(composition, 'query', selected(text)).map(
    (step) => `${step.type}.${step.field}@${step.subgraphs.join('|')}${step.hop === undefined ? '' : ` hop from ${step.hop.from}`}${step.requiredBy === undefined ? '' : ` for ${step.requiredBy}`}`,
  );

const ORDERS = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", { name: "@shareable", as: "@shared" }, "@provides", "@external"])
  type Query { orders: [Order!]! regions: [String!]! @shared }
  type Order @key(fields: "id") { id: ID! total: Float! customer: Customer! @provides(fields: "name") }
  type Customer @key(fields: "id") { id: ID! name: String! @external orders: [Order!]! }
`;
const CUSTOMERS = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable", "@inaccessible", "@requires", "@external", "@override"])
  type Query { customer(id: ID!): Customer regions: [String!]! @shareable }
  type Customer @key(fields: "id") { id: ID! name: String! email: String! note: String @inaccessible }
  type Order @key(fields: "id") { id: ID! total: Float! @external points: Int! @requires(fields: "total") }
`;

describe('the language: directive arguments (P241)', () => {
  it('keeps each directive with its arguments as values', () => {
    const [definition] = parseDocument('type Customer @key(fields: "id", resolvable: false) @tag(names: ["a", "b"]) { id: ID! }').definitions;
    if (definition?.kind !== 'type') throw new Error('no type');
    const [key, tag] = definition.applied;
    expect(key?.name).toBe('key');
    expect(stringsOf(argumentOf(key!, 'fields'))).toEqual(['id']);
    expect(argumentOf(key!, 'resolvable')).toEqual({ kind: 'literal', text: 'false' });
    expect(stringsOf(argumentOf(tag!, 'names'))).toEqual(['a', 'b']);
  });

  it('reads the directives of a field, of an enum value and of an extended schema', () => {
    const document = parseDocument(`
      extend schema @link(url: "https://specs.apollo.dev/federation/v2.0", import: ["@key"])
      type Order { id: ID! @external }
      enum join__Graph { ORDERS @join__graph(name: "orders", url: "http://orders:4001/graphql") }
    `);
    const [schema, order, graph] = document.definitions;
    expect(schema?.kind === 'schema' && schema.extend && schema.directives[0]?.name).toBe('link');
    expect(order?.kind === 'type' && order.fields[0]?.directives.map((directive) => directive.name)).toEqual(['external']);
    expect(graph?.kind === 'type' && stringsOf(argumentOf(graph.enumValues[0]!.directives[0]!, 'url'))).toEqual(['http://orders:4001/graphql']);
  });

  it('undoes a block string the way the specification says', () => {
    const [definition] = parseDocument('type T @doc(text: """\n    first\n      second\n  """) { id: ID }').definitions;
    expect(definition?.kind === 'type' && stringsOf(argumentOf(definition.applied[0]!, 'text'))).toEqual(['first\n  second']);
  });
});

describe('a subgraph schema (P241)', () => {
  it('reads federation 2 directives under the names they are imported as', () => {
    const schema = sdl(ORDERS);
    expect(schema.federation).toBe(2);
    expect(schema.types['Order']?.federation?.keys).toEqual([{ fields: 'id' }]);
    expect(schema.types['Query']?.fields?.['regions']?.federation).toEqual({ shareable: true });
    expect(schema.types['Order']?.fields?.['customer']?.federation).toEqual({ provides: 'name' });
    expect(schema.types['Customer']?.fields?.['name']?.federation).toEqual({ external: true });
  });

  it('reads a namespaced directive and an override with a label', () => {
    const schema = sdl(`
      extend schema @link(url: "https://specs.apollo.dev/federation/v2.7")
      type Order @federation__key(fields: "id") { id: ID! total: Float! @federation__override(from: "orders", label: "percent(10)") }
    `);
    expect(schema.types['Order']?.federation?.keys).toEqual([{ fields: 'id' }]);
    expect(schema.types['Order']?.fields?.['total']?.federation).toEqual({ override: { from: 'orders', label: 'percent(10)' } });
  });

  it('reads federation 1: an extended entity whose key is another subgraph\'s', () => {
    const schema = sdl('extend type Customer @key(fields: "id") { id: ID! @external orders: [Order] } type Order @key(fields: "id") { id: ID! }');
    expect(schema.federation).toBe(1);
    expect(schema.types['Customer']?.federation).toEqual({ keys: [{ fields: 'id' }], extension: true });
  });

  it('reads code-first directives and a reference resolver from NestJS', () => {
    const made = new Project({ useInMemoryFileSystem: true, compilerOptions: { experimentalDecorators: true } });
    made.createSourceFile(
      'customers.ts',
      [
        '@ObjectType()',
        '@Directive(\'@key(fields: "id")\')',
        'class Customer { @Field(() => ID) id: string; @Field() @Directive(\'@shareable\') name: string; }',
        '@Resolver(() => Customer)',
        'class CustomersResolver {',
        '  @Query(() => Customer) customer(@Args(\'id\') id: string) { return null; }',
        '  @ResolveReference() resolveReference(reference: { id: string }) { return null; }',
        '}',
        'GraphQLModule.forRoot({ driver: ApolloFederationDriver, autoSchemaFile: { federation: 2 } });',
      ].join('\n'),
    );
    const reading = readGraphqlServer(made.getSourceFiles(), { schemaFiles: [], dependencies: new Set() });
    expect(reading.federation).toBe(2);
    expect(reading.schema.types['Customer']?.federation?.keys).toEqual([{ fields: 'id' }]);
    expect(reading.schema.types['Customer']?.fields?.['name']?.federation).toEqual({ shareable: true });
    expect(reading.fields.find((field) => field.reference === true)).toMatchObject({ type: 'Customer', field: '__resolveReference', root: false });
  });

  it('reads the modules of buildSubgraphSchema([...]) and a reference resolver in a map', () => {
    const made = new Project({ useInMemoryFileSystem: true });
    made.createSourceFile(
      'index.ts',
      [
        'const typeDefs = gql`type Query { orders: [Order!]! } type Order @key(fields: "id") { id: ID! }`;',
        'const resolvers = { Query: { orders: () => [] }, Order: { __resolveReference: (ref) => ref, __resolveType: () => "Order" } };',
        'new ApolloServer({ schema: buildSubgraphSchema([{ typeDefs, resolvers }]) });',
      ].join('\n'),
    );
    const reading = readGraphqlServer(made.getSourceFiles(), { schemaFiles: [], dependencies: new Set() });
    expect(reading.fields.map((field) => `${field.type}.${field.field}${field.reference === true ? ' (reference)' : ''}`).sort()).toEqual(['Order.__resolveReference (reference)', 'Query.orders']);
    expect(reading.federation).toBe(1);
  });
});

describe('composition from subgraphs (P241, D4)', () => {
  const { composition, conflicts } = composeSubgraphs([
    { name: 'orders', schema: sdl(ORDERS) },
    { name: 'customers', schema: sdl(CUSTOMERS) },
  ]);

  it('gives a field to every subgraph that declares it and does not mark it external', () => {
    expect(composition.types['Customer']?.fields['name']?.owners.map((owner) => owner.subgraph)).toEqual(['customers']);
    expect(composition.types['Customer']?.fields['orders']?.owners.map((owner) => owner.subgraph)).toEqual(['orders']);
    expect(composition.types['Order']?.fields['total']?.owners.map((owner) => owner.subgraph)).toEqual(['orders']);
    expect(composition.types['Order']?.fields['points']?.owners).toEqual([{ subgraph: 'customers', requires: 'total' }]);
    expect(composition.types['Query']?.fields['regions']?.owners.map((owner) => owner.subgraph)).toEqual(['customers', 'orders']);
  });

  it('keeps each subgraph\'s keys, and leaves out the machinery', () => {
    expect(composition.types['Customer']?.keys).toEqual({ customers: ['id'], orders: ['id'] });
    expect(Object.keys(composition.types).some((name) => name.startsWith('_'))).toBe(false);
  });

  it('accepts shared fields and key fields, and refuses two owners that do not share', () => {
    expect(conflicts).toEqual([]);
    const refused = composeSubgraphs([
      { name: 'a', schema: sdl('extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"]) type Query { status: String! }') },
      { name: 'b', schema: sdl('extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"]) type Query { status: String! }') },
    ]);
    expect(refused.conflicts).toEqual([{ kind: 'shared', type: 'Query', field: 'status', subgraphs: ['a', 'b'] }]);
  });

  it('moves a field with @override, and keeps both owners for a labelled one', () => {
    const link = 'extend schema @link(url: "https://specs.apollo.dev/federation/v2.7", import: ["@key", "@override"])';
    const moved = composeSubgraphs([
      { name: 'old', schema: sdl(`${link} type Order @key(fields: "id") { id: ID! total: Float! }`) },
      { name: 'new', schema: sdl(`${link} type Order @key(fields: "id") { id: ID! total: Float! @override(from: "old") }`) },
    ]);
    expect(moved.composition.types['Order']?.fields['total']?.owners.map((owner) => owner.subgraph)).toEqual(['new']);
    expect(moved.conflicts).toEqual([]);
    const progressive = composeSubgraphs([
      { name: 'old', schema: sdl(`${link} type Order @key(fields: "id") { id: ID! total: Float! }`) },
      { name: 'new', schema: sdl(`${link} type Order @key(fields: "id") { id: ID! total: Float! @override(from: "old", label: "percent(5)") }`) },
    ]);
    expect(progressive.composition.types['Order']?.fields['total']?.owners).toEqual([{ subgraph: 'new', label: 'percent(5)' }, { subgraph: 'old' }]);
    expect(progressive.conflicts).toEqual([]);
  });

  it('accepts a federation 1 value type in two subgraphs', () => {
    const shared = composeSubgraphs([
      { name: 'a', schema: sdl('type Money { amount: Float! } type Order @key(fields: "id") { id: ID! price: Money! }') },
      { name: 'b', schema: sdl('type Money { amount: Float! } type Query { total: Money! }') },
    ]);
    expect(shared.conflicts).toEqual([]);
  });

  it('says a field an entity call cannot reach', () => {
    const unreachable = composeSubgraphs([
      { name: 'orders', schema: sdl('extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key"]) type Query { orders: [Order!]! } type Order @key(fields: "id") { id: ID! customer: Customer! } type Customer @key(fields: "id") { id: ID! }') },
      { name: 'loyalty', schema: sdl('extend schema @link(url: "https://specs.apollo.dev/federation/v2.3", import: ["@key", "@shareable"]) type Customer { id: ID! @shareable points: Int! }') },
    ]);
    expect(unreachableOwners(unreachable.composition)).toEqual([{ kind: 'unreachable', type: 'Customer', field: 'points', subgraphs: ['loyalty'] }]);
  });

  it('serves the composed API schema with a hidden field marked', () => {
    const api = apiSchemaOf(composition);
    expect(api.types['Customer']?.fields?.['note']?.federation).toEqual({ inaccessible: true });
    expect(api.types['Query']?.fields?.['customer']?.args).toEqual({ id: { type: 'ID!', required: true } });
  });
});

describe('a supergraph (P241, D3)', () => {
  const text = `
    schema @link(url: "https://specs.apollo.dev/join/v0.3", for: EXECUTION) { query: Query }
    enum join__Graph {
      CUSTOMERS @join__graph(name: "customers", url: "http://customers:4002/graphql")
      ORDERS @join__graph(name: "orders", url: "http://orders:4001/graphql")
    }
    type Customer @join__type(graph: CUSTOMERS, key: "id") @join__type(graph: ORDERS, key: "id", resolvable: false) {
      id: ID!
      name: String! @join__field(graph: CUSTOMERS)
      secret: String @join__field(graph: CUSTOMERS) @inaccessible
    }
    type Order @join__type(graph: ORDERS, key: "id") {
      id: ID!
      customer: Customer! @join__field(graph: ORDERS)
      total: Float! @join__field(graph: CUSTOMERS, external: true) @join__field(graph: ORDERS)
    }
    type Query @join__type(graph: CUSTOMERS) @join__type(graph: ORDERS) {
      orders: [Order!]! @join__field(graph: ORDERS)
      regions: [String!]!
    }
  `;
  const { composition, graphs } = supergraphComposition(parseDocument(text), text);

  it('names each subgraph with its address and its line', () => {
    expect(graphs.map((graph) => `${graph.name} ${graph.url}`)).toEqual(['customers http://customers:4002/graphql', 'orders http://orders:4001/graphql']);
  });

  it('reads each field\'s owners from @join__field, or the type\'s subgraphs where it has none', () => {
    expect(composition.types['Order']?.fields['total']?.owners.map((owner) => owner.subgraph)).toEqual(['orders']);
    expect(composition.types['Query']?.fields['regions']?.owners.map((owner) => owner.subgraph)).toEqual(['customers', 'orders']);
    expect(composition.types['Customer']?.fields['id']?.owners.map((owner) => owner.subgraph)).toEqual(['customers', 'orders']);
    expect(composition.types['Customer']?.keys).toEqual({ customers: ['id'] });
    expect(composition.types['Customer']?.stubs).toEqual({ orders: ['id'] });
    expect(composition.types['Customer']?.fields['secret']?.inaccessible).toBe(true);
    expect(composition.types['Customer']?.fields['name']?.line).toBe(9);
    expect(composition.types['join__Graph']).toBeUndefined();
  });
});

describe('a plan (P241, D5-D7)', () => {
  const { composition } = composeSubgraphs([
    { name: 'orders', schema: sdl(ORDERS) },
    { name: 'customers', schema: sdl(CUSTOMERS) },
  ]);

  it('sends a root field to its owner, keeps what that subgraph owns, and hops for the rest', () => {
    expect(planned(composition, 'orders { id customer { id email } }')).toEqual([
      'Query.orders@orders',
      'Order.id@orders',
      'Order.customer@orders',
      'Customer.id@orders',
      'Customer.email@customers hop from orders',
    ]);
  });

  it('keeps a field the parent provides in the parent\'s subgraph', () => {
    expect(planned(composition, 'orders { customer { name } }')).toEqual(['Query.orders@orders', 'Order.customer@orders', 'Customer.name@orders']);
  });

  it('hops back for a field another subgraph contributes to an entity', () => {
    expect(planned(composition, 'customer { name orders { total } }')).toEqual(['Query.customer@customers', 'Customer.name@customers', 'Customer.orders@orders hop from customers', 'Order.total@orders']);
  });

  it('plans what a field requires before it, from the parent\'s subgraph', () => {
    expect(planned(composition, 'orders { points }')).toEqual(['Query.orders@orders', 'Order.points@customers hop from orders', 'Order.total@orders for Order.points']);
  });

  it('says a shareable root field as a choice, and the same field under its own subgraph as none', () => {
    expect(planned(composition, 'regions')).toEqual(['Query.regions@customers|orders']);
    const [step] = planSelection(composition, 'query', selected('regions'));
    expect(step?.subgraphs).toEqual(['customers', 'orders']);
  });
});

describe('a gateway (P241)', () => {
  const read = (text: string) => {
    const made = new Project({ useInMemoryFileSystem: true, compilerOptions: { experimentalDecorators: true } });
    made.createSourceFile('main.ts', text);
    return readGraphqlGateway(made.getSourceFiles(), { repoDir: '/repo', supergraphs: [], rover: [] });
  };

  it('reads the subgraphs IntrospectAndCompose names, each address as written', () => {
    const reading = read(
      [
        'const subgraphs = [{ name: "orders", url: process.env.ORDERS_URL }, { name: "customers", url: `${process.env.CUSTOMERS_URL}/graphql` }];',
        'new ApolloGateway({ supergraphSdl: new IntrospectAndCompose({ subgraphs: [...subgraphs, { name: "reviews", url: "http://reviews:4003/graphql" }] }) });',
      ].join('\n'),
    );
    expect(reading?.kind).toBe('subgraphs');
    if (reading?.kind !== 'subgraphs') return;
    expect(reading.subgraphs.map((route) => [route.name, routeAddress(route.address)])).toEqual([
      ['orders', { path: '', baseUrlEnv: 'ORDERS_URL' }],
      ['customers', { path: '/graphql', baseUrlEnv: 'CUSTOMERS_URL' }],
      ['reviews', { url: 'http://reviews:4003/graphql', host: 'reviews:4003', path: '/graphql' }],
    ]);
  });

  it('reads federation 1\'s serviceList and NestJS\'s ApolloGatewayDriver', () => {
    expect(read('new ApolloGateway({ serviceList: [{ name: "orders", url: "http://orders/graphql" }] });')?.kind).toBe('subgraphs');
    const nest = read('GraphQLModule.forRoot({ driver: ApolloGatewayDriver, gateway: { supergraphSdl: new IntrospectAndCompose({ subgraphs: [{ name: "a", url: "http://a/graphql" }] }) } });');
    expect(nest?.kind === 'subgraphs' && nest.subgraphs.map((route) => route.name)).toEqual(['a']);
  });

  it('says managed federation, and a supergraph built at start, precisely', () => {
    expect(read('new ApolloGateway();')).toMatchObject({ kind: 'unread', detail: 'managed' });
    expect(read('new ApolloGateway({ supergraphSdl: new UplinkSupergraphManager({ apiKey: process.env.APOLLO_KEY }) });')).toMatchObject({ kind: 'unread', detail: 'managed' });
    expect(read('new ApolloGateway({ supergraphSdl: async () => ({ supergraphSdl: await fetchIt() }) });')).toMatchObject({ kind: 'unread', detail: 'built-at-start' });
    expect(read('new ApolloGateway({ supergraphSdl: readFileSync(join(__dirname, "supergraph.graphql"), "utf8") });')).toMatchObject({ kind: 'unread', detail: 'not-committed' });
  });

  it('reads rover\'s configuration and the router\'s overrides, settings included', () => {
    const rover = readRoverConfig(
      ['subgraphs:', '  orders:', '    routing_url: ${env.ORDERS_URL}/graphql', '    schema:', '      subgraph_url: http://orders:4001/graphql', '  reviews:', '    routing_url: http://reviews/graphql', '    schema:', '      graphref: shop@main'].join('\n'),
      'router/supergraph.yaml',
    );
    expect(rover.subgraphs.map((route) => [route.name, route.address, 'line' in route.at ? route.at.line : 0, route.registry])).toEqual([
      ['orders', { kind: 'setting', env: 'ORDERS_URL', path: '/graphql' }, 2, undefined],
      ['reviews', { kind: 'literal', url: 'http://reviews/graphql' }, 6, 'shop@main'],
    ]);
    const router = readRouterConfig('supergraph:\n  path: /graphql\noverride_subgraph_url:\n  orders: http://orders:4001/graphql\n', 'router/router.yaml');
    expect(router.path).toBe('/graphql');
    expect(router.overrides).toEqual([{ name: 'orders', address: { kind: 'literal', url: 'http://orders:4001/graphql' }, line: 4 }]);
    expect(addressOfText('${env.X:-http://x}/q')).toEqual({ kind: 'setting', env: 'X', path: '/q', fallback: 'http://x' });
  });
});
