import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { apiSchemaOf, composeSubgraphs, supergraphComposition, unreachableOwners, type Composition } from './federation.js';
import type { MetaField } from './meta.js';
import { parseDocument } from './parse.js';
import { planSelection } from './plan.js';
import { authLabel, schemaOf } from './schema.js';
import { readGraphqlServer } from './servers.js';

/**
 * Entity interfaces, `@interfaceObject`, contexts, the router's authorization
 * directives, composed directives and where a subgraph listens (P245).
 */

const sdl = (text: string) => schemaOf([parseDocument(text)]);

/** Selections as a request node keeps them, inline fragments included: `media { ... on Book { author } }`. */
const selected = (text: string): MetaField[] => {
  const [operation] = parseDocument(`{ ${text} }`).definitions;
  if (operation?.kind !== 'operation') throw new Error('not an operation');
  const walk = (selections: typeof operation.selections, on?: string): MetaField[] =>
    selections.flatMap((selection): MetaField[] =>
      selection.kind === 'field'
        ? [{ field: selection.name, line: 1, ...(on === undefined ? {} : { on }), ...(selection.selections.length === 0 ? {} : { selections: walk(selection.selections) }) }]
        : selection.kind === 'inline'
          ? walk(selection.selections, selection.on)
          : [],
    );
  return walk(operation.selections);
};

/** A plan, as `Type.field@subgraph`, with the entity a hop is for, the type it resolves under, and what asked for it. */
const planned = (composition: Composition, text: string): string[] =>
  planSelection(composition, 'query', selected(text)).map(
    (step) =>
      `${step.type}.${step.field}@${step.subgraphs.join('|')}` +
      `${step.as === undefined ? '' : ` as ${Object.values(step.as).join('|')}`}` +
      `${step.hop === undefined ? '' : ` hop ${step.hop.entity} from ${step.hop.from}`}` +
      `${step.requiredBy === undefined ? '' : ` for ${step.requiredBy}`}` +
      `${step.fromContext === undefined ? '' : ` from ${step.fromContext}`}` +
      `${step.unset === undefined ? '' : ` unset ${step.unset.map((each) => `${each.argument}<-${each.context}`).join(',')}`}`,
  );

const MEDIA = `
  extend schema
    @link(url: "https://specs.apollo.dev/federation/v2.8", import: ["@key", "@requiresScopes", "@composeDirective"])
    @link(url: "https://example.dev/audit/v1.0", import: ["@audited"])
    @composeDirective(name: "@audited")
  directive @audited(reason: String) on FIELD_DEFINITION
  type Query { media: [Media!]! }
  interface Media @key(fields: "id") { id: ID! title: String! }
  type Book implements Media @key(fields: "id") { id: ID! title: String! author: String! @audited(reason: "licensing") }
  type Movie implements Media @key(fields: "id") { id: ID! title: String! director: String! @requiresScopes(scopes: [["media:staff"]]) }
`;
const REVIEWS = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.8", import: ["@key", "@interfaceObject", { name: "@authenticated", as: "@signedIn" }])
  type Query { topRated: [Media!]! }
  type Media @key(fields: "id") @interfaceObject { id: ID! reviews: [Review!]! rating: Float @signedIn }
  type Review { score: Int! }
`;
const ACCOUNTS = `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.8", import: ["@key", "@context", "@fromContext", "@policy"])
  type Query { me: User wishItem(id: ID!): WishItem }
  type User @key(fields: "id") @context(name: "viewer") {
    id: ID!
    currency: String!
    email: String! @policy(policies: [["owner"], ["support", "staff"]])
    wishlist: [WishItem!]!
  }
  type WishItem { id: ID! price(currency: String @fromContext(field: "$viewer { currency }")): Float! }
`;

const composed = (): ReturnType<typeof composeSubgraphs> =>
  composeSubgraphs([
    { name: 'media', schema: sdl(MEDIA) },
    { name: 'reviews', schema: sdl(REVIEWS) },
    { name: 'accounts', schema: sdl(ACCOUNTS) },
  ]);

describe('a subgraph schema, read further (P245)', () => {
  it('keeps the directives written on an argument', () => {
    const [definition] = parseDocument('type T { f(a: String @fromContext(field: "$c { x }")): Int }').definitions;
    expect(definition?.kind === 'type' && definition.fields[0]?.arguments[0]?.directives.map((directive) => directive.name)).toEqual(['fromContext']);
  });

  it('reads an interface object, a context and an argument taken from it, and the router\'s directives under their imported names', () => {
    const reviews = sdl(REVIEWS);
    expect(reviews.types['Media']?.federation).toEqual({ keys: [{ fields: 'id' }], interfaceObject: true });
    expect(reviews.types['Media']?.fields?.['rating']?.federation).toEqual({ auth: [{ kind: 'authenticated' }] });
    const accounts = sdl(ACCOUNTS);
    expect(accounts.types['User']?.federation?.contexts).toEqual(['viewer']);
    expect(accounts.types['WishItem']?.fields?.['price']?.federation).toEqual({ fromContext: { currency: { context: 'viewer', selection: 'currency' } } });
    expect(accounts.types['User']?.fields?.['email']?.federation?.auth?.map(authLabel)).toEqual(['@policy(owner | support & staff)']);
  });

  it('reads the directives a subgraph composes, with their specification, and where they are applied', () => {
    const media = sdl(MEDIA);
    expect(media.composeDirectives).toEqual([{ name: 'audited', url: 'https://example.dev/audit/v1.0', defined: true }]);
    expect(media.types['Book']?.fields?.['author']?.federation).toEqual({ directives: ['audited'] });
    expect(media.types['Movie']?.fields?.['director']?.federation?.auth).toEqual([{ kind: 'scopes', any: [['media:staff']] }]);
  });
});

describe('composition, entity interfaces and the rest (P245)', () => {
  it('composes the interface its owner declares, and gives every implementation what the interface object adds', () => {
    const { composition, conflicts } = composed();
    const media = composition.types['Media'];
    expect([media?.kind, media?.interfaceObjects, media?.keys]).toEqual(['interface', ['reviews'], { media: ['id'], reviews: ['id'] }]);
    expect(composition.types['Book']?.fields['reviews']?.owners).toEqual([{ subgraph: 'reviews', as: 'Media' }]);
    expect(composition.types['Movie']?.fields['rating']?.auth).toEqual([{ kind: 'authenticated' }]);
    expect(composition.types['Book']?.fields['title']?.owners).toEqual([{ subgraph: 'media' }]);
    expect(conflicts).toEqual([]);
    expect(unreachableOwners(composition)).toEqual([]);
  });

  it('qualifies a context by its subgraph, and keeps an argument it fills out of the API', () => {
    const { composition } = composed();
    expect(composition.types['User']?.contexts).toEqual(['accounts__viewer']);
    expect(composition.types['WishItem']?.fields['price']?.owners).toEqual([{ subgraph: 'accounts', context: [{ argument: 'currency', context: 'accounts__viewer', selection: 'currency' }] }]);
    expect(apiSchemaOf(composition).types['WishItem']?.fields?.['price']).toEqual({ type: 'Float!' });
    expect(apiSchemaOf(composition).types['Book']?.fields?.['reviews']).toEqual({ type: '[Review!]!' });
  });

  it('keeps a composed directive, and refuses one never defined or taken from two specifications', () => {
    expect(composed().composition.directives).toEqual({ audited: { subgraphs: ['media'], url: 'https://example.dev/audit/v1.0' } });
    expect(composed().composition.types['Book']?.fields['author']?.directives).toEqual(['audited']);
    const other = `
      extend schema
        @link(url: "https://specs.apollo.dev/federation/v2.8", import: ["@key", "@composeDirective"])
        @link(url: "https://example.dev/audit/v2.0", import: ["@audited"])
        @composeDirective(name: "@audited") @composeDirective(name: "@missing")
      type Query { shelf: [String!]! }
    `;
    const { conflicts } = composeSubgraphs([
      { name: 'media', schema: sdl(MEDIA) },
      { name: 'shelves', schema: sdl(other) },
    ]);
    expect(conflicts).toEqual([
      { kind: 'directive', type: '@missing', field: '', subgraphs: ['shelves'] },
      { kind: 'directive', type: '@audited', field: '', subgraphs: ['media', 'shelves'], urls: ['https://example.dev/audit/v1.0', 'https://example.dev/audit/v2.0'] },
    ]);
  });
});

const SUPERGRAPH = `
schema
  @link(url: "https://specs.apollo.dev/link/v1.0")
  @link(url: "https://specs.apollo.dev/join/v0.5", for: EXECUTION)
  @link(url: "https://specs.apollo.dev/authenticated/v0.1", for: SECURITY)
  @link(url: "https://specs.apollo.dev/requiresScopes/v0.1", for: SECURITY)
  @link(url: "https://specs.apollo.dev/policy/v0.1", as: "access", for: SECURITY)
  @link(url: "https://specs.apollo.dev/context/v0.1", for: SECURITY)
  @link(url: "https://example.dev/audit/v1.0", import: ["@audited"])
{ query: Query }

directive @audited(reason: String) on FIELD_DEFINITION
directive @authenticated on FIELD_DEFINITION | OBJECT | INTERFACE | SCALAR | ENUM
directive @requiresScopes(scopes: [[requiresScopes__Scope!]!]!) on FIELD_DEFINITION | OBJECT | INTERFACE | SCALAR | ENUM
directive @access(policies: [[access__Policy!]!]!) on FIELD_DEFINITION | OBJECT | INTERFACE | SCALAR | ENUM
directive @context(name: String!) repeatable on INTERFACE | OBJECT | UNION
directive @join__graph(name: String!, url: String!) on ENUM_VALUE

enum join__Graph {
  ACCOUNTS @join__graph(name: "accounts", url: "http://localhost:4003/graphql")
  MEDIA @join__graph(name: "media", url: "http://localhost:4001/graphql")
  REVIEWS @join__graph(name: "reviews", url: "http://localhost:4002/graphql")
}

type Query @join__type(graph: ACCOUNTS) @join__type(graph: MEDIA) @join__type(graph: REVIEWS) {
  me: User @join__field(graph: ACCOUNTS)
  wishItem(id: ID!): WishItem @join__field(graph: ACCOUNTS)
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
  author: String! @audited(reason: "licensing")
  reviews: [Review!]! @join__field
  rating: Float @join__field @authenticated
}

type Movie implements Media @join__implements(graph: MEDIA, interface: "Media") @join__type(graph: MEDIA, key: "id") {
  id: ID!
  title: String!
  director: String! @requiresScopes(scopes: [["media:staff"]])
  reviews: [Review!]!
  rating: Float @authenticated
}

type Review @join__type(graph: REVIEWS) { score: Int! }

type User @join__type(graph: ACCOUNTS, key: "id") @context(name: "accounts__viewer") {
  id: ID!
  currency: String!
  email: String! @access(policies: [["owner"], ["support", "staff"]])
  wishlist: [WishItem!]!
}

type WishItem @join__type(graph: ACCOUNTS) {
  id: ID!
  price(currency: String): Float! @join__field(graph: ACCOUNTS, contextArguments: [{context: "accounts__viewer", name: "currency", type: "String", selection: "{ currency }"}])
}
`;

describe('a supergraph, read further (P245)', () => {
  const { composition } = supergraphComposition(parseDocument(SUPERGRAPH), SUPERGRAPH);

  it('reads an interface object from @join__type, and gives an implementation\'s bare or defaulted field to it', () => {
    expect(composition.types['Media']?.interfaceObjects).toEqual(['reviews']);
    expect(composition.types['Book']?.fields['reviews']?.owners).toEqual([{ subgraph: 'reviews', as: 'Media' }]);
    // Written with no @join__field at all, the type's subgraph would be its owner; the interface object is.
    expect(composition.types['Movie']?.fields['reviews']?.owners).toEqual([{ subgraph: 'reviews', as: 'Media' }]);
    expect(composition.types['Book']?.fields['title']?.owners).toEqual([{ subgraph: 'media' }]);
  });

  it('reads the router\'s directives through their links, renamed ones included, contexts and their arguments, and composed directives', () => {
    expect(composition.types['Book']?.fields['rating']?.auth).toEqual([{ kind: 'authenticated' }]);
    expect(composition.types['Movie']?.fields['director']?.auth?.map(authLabel)).toEqual(['@requiresScopes(media:staff)']);
    expect(composition.types['User']?.fields['email']?.auth?.map(authLabel)).toEqual(['@policy(owner | support & staff)']);
    expect(composition.types['User']?.contexts).toEqual(['accounts__viewer']);
    expect(composition.types['WishItem']?.fields['price']?.owners[0]?.context).toEqual([{ argument: 'currency', context: 'accounts__viewer', selection: 'currency' }]);
    expect(composition.directives).toEqual({ audited: { url: 'https://example.dev/audit/v1.0' } });
    expect(composition.types['Book']?.fields['author']?.directives).toEqual(['audited']);
  });

  it('plans the same as the composition of the subgraphs it was composed from', () => {
    const query = 'media { title reviews { score } ... on Book { author rating } } me { wishlist { price } }';
    expect(planned(composition, query)).toEqual(planned(composed().composition, query));
  });
});

describe('a plan through entity interfaces and contexts (P245)', () => {
  const { composition } = composed();

  it('hops to the interface object for what it adds, as the interface, from the interface\'s owner', () => {
    expect(planned(composition, 'media { title reviews { score } ... on Book { author rating } }')).toEqual([
      'Query.media@media',
      'Media.title@media',
      'Media.reviews@reviews hop Media from media',
      'Review.score@reviews',
      'Book.author@media',
      'Book.rating@reviews as Media hop Media from media',
    ]);
  });

  it('asks the interface\'s owner which type a value is, where an interface object fetched it', () => {
    expect(planned(composition, 'topRated { rating title ... on Book { author } ... on Movie { reviews { score } } }')).toEqual([
      'Query.topRated@reviews',
      'Media.__typename@media hop Media from reviews',
      'Media.rating@reviews',
      'Media.title@media hop Media from reviews',
      'Book.author@media hop Media from reviews',
      'Movie.reviews@reviews as Media',
      'Review.score@reviews',
    ]);
  });

  it('plans what a context gives an argument from the nearest type above that sets it, and says where none does', () => {
    expect(planned(composition, 'me { wishlist { price } }')).toEqual(['Query.me@accounts', 'User.wishlist@accounts', 'WishItem.price@accounts', 'User.currency@accounts for WishItem.price from viewer']);
    expect(planned(composition, 'wishItem { price }')).toEqual(['Query.wishItem@accounts', 'WishItem.price@accounts unset currency<-viewer']);
  });
});

describe('a subgraph in code (P245)', () => {
  it('reads where a server listens: a port, a fallback beside a setting, the standalone default', () => {
    const made = new Project({ useInMemoryFileSystem: true });
    made.createSourceFile('a.ts', 'startStandaloneServer(server, { listen: { port: 4001 } });');
    made.createSourceFile('b.ts', 'const port = Number(process.env.PORT) || 4002; app.listen(port, () => {});');
    made.createSourceFile('c.ts', 'await app.listen(process.env.PORT ?? 4003);');
    made.createSourceFile('d.ts', 'startStandaloneServer(server);');
    made.createSourceFile('e.ts', 'app.listen({ port: config.get("PORT", 4005) }); app.listen(process.env.PORT);');
    const ports = (file: string) =>
      readGraphqlServer([made.getSourceFileOrThrow(file)], { schemaFiles: [], dependencies: new Set() }).listen.map((port) => [port.port, port.setting]);
    expect(ports('a.ts')).toEqual([[4001, undefined]]);
    expect(ports('b.ts')).toEqual([[4002, 'PORT']]);
    expect(ports('c.ts')).toEqual([[4003, 'PORT']]);
    expect(ports('d.ts')).toEqual([[4000, undefined]]);
    // The library's own default, said so, as every reader of a port says it (P250).
    expect(readGraphqlServer([made.getSourceFileOrThrow('d.ts')], { schemaFiles: [], dependencies: new Set() }).listen[0]?.default).toBe(true);
    expect(ports('e.ts')).toEqual([[4005, 'PORT']]);
  });

  it('reads a code-first entity interface, the types that implement it, an interface object and the router\'s directives', () => {
    const made = new Project({ useInMemoryFileSystem: true, compilerOptions: { experimentalDecorators: true } });
    made.createSourceFile(
      'media.ts',
      [
        '@InterfaceType()',
        '@Directive(\'@key(fields: "id")\')',
        'class Media { @Field(() => ID) id: string; }',
        '@ObjectType({ implements: () => [Media] })',
        'class Book { @Field(() => ID) id: string; @Field() @Directive(\'@authenticated\') author: string; }',
        '@ObjectType(\'Clip\')',
        '@Directive(\'@interfaceObject\')',
        '@Directive(\'@key(fields: "id")\')',
        'class ClipObject { @Field(() => ID) id: string; }',
      ].join('\n'),
    );
    const { schema } = readGraphqlServer(made.getSourceFiles(), { schemaFiles: [], dependencies: new Set() });
    expect([schema.types['Media']?.kind, schema.types['Media']?.possible, schema.types['Media']?.federation?.keys]).toEqual(['interface', ['Book'], [{ fields: 'id' }]]);
    expect(schema.types['Book']?.fields?.['author']?.federation).toEqual({ auth: [{ kind: 'authenticated' }] });
    expect(schema.types['Clip']?.federation?.interfaceObject).toBe(true);
  });
});

describe('what a field is read off, and an entity call nobody can type (P252)', () => {
  const { composition } = composed();

  it('names the step whose resolver returned the object each field is read from', () => {
    const steps = planSelection(composition, 'query', selected('media { title ... on Book { author rating } }'));
    expect(steps.map((step) => [`${step.type}.${step.field}`, step.parent === undefined ? undefined : `${steps[step.parent]?.type}.${steps[step.parent]?.field}`])).toEqual([
      ['Query.media', undefined],
      ['Media.title', 'Query.media'],
      ['Book.author', 'Query.media'],
      ['Book.rating', 'Query.media'],
    ]);
  });

  it('says an entity call for an interface is untyped where its owner says no type of it, and only then', () => {
    const typed = planSelection(composition, 'query', selected('topRated { title }'), { saysType: () => true });
    const untyped = planSelection(composition, 'query', selected('topRated { title }'), { saysType: (subgraph) => subgraph !== 'media' });
    expect(typed.map((step) => step.hop?.untyped)).toEqual([undefined, undefined]);
    expect(untyped.map((step) => [`${step.type}.${step.field}`, step.hop?.untyped])).toEqual([
      ['Query.topRated', undefined],
      ['Media.title', true],
    ]);
    // An entity call into the interface object is for an object type there, whatever the owner says.
    expect(planSelection(composition, 'query', selected('media { reviews { score } }'), { saysType: () => false }).map((step) => step.hop?.untyped)).toEqual([undefined, undefined, undefined]);
  });

  it('reads the types whose concrete type the code says: a map, a schema-first resolver class, decorator and union options', () => {
    const made = new Project({ useInMemoryFileSystem: true, compilerOptions: { experimentalDecorators: true } });
    made.createSourceFile('map.ts', 'new ApolloServer({ resolvers: { Media: { __resolveType: (item) => item.kind }, Book: { __isTypeOf: (item) => true, title: () => "" } } });');
    made.createSourceFile('nest.ts', "@Resolver('Result') class ResultResolver { @ResolveField() __resolveType(value) { return 'Book'; } }");
    made.createSourceFile('first.ts', "@InterfaceType('Clip', { resolveType: (value) => 'Trailer' }) class ClipType { @Field() id: string; }");
    made.createSourceFile('union.ts', "export const Found = createUnionType({ name: 'Found', types: () => [Book] as const, resolveType: (value) => 'Book' });");
    const reading = readGraphqlServer(made.getSourceFiles(), { schemaFiles: [], dependencies: new Set() });
    expect(reading.typeResolvers).toEqual(['Book', 'Clip', 'Found', 'Media', 'Result']);
    // How a type picks its member is not a field anybody selects.
    expect(reading.fields.map((field) => `${field.type}.${field.field}`)).toEqual(['Book.title']);
  });
});
