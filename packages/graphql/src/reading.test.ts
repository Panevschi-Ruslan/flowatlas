import { Project, SyntaxKind, type CallExpression } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { graphqlCallOf } from './calls.js';
import { documentOf, lineInFile, type DocumentReading } from './documents.js';
import { operationMeta, type MetaField } from './meta.js';
import { operationsOf } from './operations.js';
import { graphqlServerHandled, readGraphqlServer } from './servers.js';

/** A project of these files; a `.graphql` file is only on its file system, as it is beside real code. */
const project = (files: Record<string, string>): Project => {
  const made = new Project({ useInMemoryFileSystem: true, compilerOptions: { experimentalDecorators: true, jsx: 4 } });
  for (const [path, text] of Object.entries(files)) {
    if (/\.(graphql|gql)$/.test(path)) made.getFileSystem().writeFileSync(path, text);
    else made.createSourceFile(path, text);
  }
  return made;
};

/** What the document handed to the first call of a callee is read as. */
const readAt = (made: Project, file: string, callee: string): Extract<DocumentReading, { kind: 'read' }> => {
  const reading = documentOf(callsIn(made, file, callee)[0]?.getArguments()[0]);
  if (reading.kind !== 'read') throw new Error(`not read: ${reading.why}`);
  return reading;
};

/** Every field of an operation's meta, depth first, as `field file:line`. */
const placed = (fields: readonly MetaField[] | undefined, document: string): string[] =>
  (fields ?? []).flatMap((field) => [`${field.field} ${field.file ?? document}:${field.line}`, ...placed(field.selections, document)]);

/** The meta of the first operation of a reading, with each path named from the root. */
const metaOf = (reading: Extract<DocumentReading, { kind: 'read' }>) => {
  const [operation] = operationsOf(reading.document, reading.fragments);
  if (operation === undefined) throw new Error('no operation');
  return operationMeta(operation, reading, (path) => path.replace(/^\//, ''), 'apollo');
};

/** The calls of a file, by the text of their callee. */
const callsIn = (made: Project, file: string, callee: string): CallExpression[] =>
  (made.getSourceFile(file)?.getDescendantsOfKind(SyntaxKind.CallExpression) ?? []).filter((call) => call.getExpression().getText() === callee);

describe('documents written in TypeScript (P232)', () => {
  it('reads a gql template with a fragment interpolated, each field at its line of the file', () => {
    const made = project({
      'queries.ts': [
        "import { gql } from '@apollo/client';",
        'const FIELDS = gql`fragment F on Order { id }`;',
        'export const ORDERS = gql`',
        '  query Orders {',
        '    orders { ...F total }',
        '  }',
        '  ${FIELDS}',
        '`;',
        "useQuery(ORDERS);",
      ].join('\n'),
    });
    const [call] = callsIn(made, 'queries.ts', 'useQuery');
    const reading = documentOf(call?.getArguments()[0]);
    expect(reading.kind).toBe('read');
    if (reading.kind !== 'read') return;
    const [operation] = operationsOf(reading.document, reading.fragments);
    expect(operation?.fields[0]?.selections.map((field) => field.field)).toEqual(['id', 'total']);
    expect(lineInFile(reading, operation?.fields[0]?.at ?? 0)).toBe(5);
  });

  it('puts a field of an interpolated fragment at its own line, whatever space the hole is written with', () => {
    const made = project({
      'queries.ts': [
        "import { gql } from '@apollo/client';",
        'const FIELDS = gql`',
        '  fragment F on Order {',
        '    id',
        '  }',
        '`;',
        'export const ORDERS = gql`',
        '  query Orders {',
        '    orders { ...F total }',
        '  }',
        '  ${ FIELDS }',
        '`;',
        'useQuery(ORDERS);',
      ].join('\n'),
    });
    const meta = metaOf(readAt(made, 'queries.ts', 'useQuery'));
    expect(placed(meta.fields, meta.document.file)).toEqual(['orders queries.ts:9', 'id queries.ts:4', 'total queries.ts:9']);
  });

  it('puts a field of a fragment written in another file in that file, at its line there', () => {
    const made = project({
      'fragments.ts': ["import { gql } from '@apollo/client';", '', 'export const ORDER_FIELDS = gql`', '  fragment OrderFields on Order {', '    id', '    customer { name }', '  }', '`;'].join('\n'),
      'queries.ts': ["import { gql } from '@apollo/client';", "import { ORDER_FIELDS } from './fragments';", 'useQuery(gql`', '  query Orders { orders { ...OrderFields } }', '  ${ORDER_FIELDS}', '`);'].join('\n'),
    });
    const meta = metaOf(readAt(made, 'queries.ts', 'useQuery'));
    expect(meta.document).toEqual({ file: 'queries.ts', line: 4 });
    expect(placed(meta.fields, meta.document.file)).toEqual(['orders queries.ts:4', 'id fragments.ts:5', 'customer fragments.ts:6', 'name fragments.ts:6']);
  });

  it('reads a .graphql file an import names, at its own lines, whether or not TypeScript knows the module', () => {
    const orders = ['#import "./fields.graphql"', '', 'query Orders {', '  orders {', '    ...OrderFields', '  }', '}', '', 'query Order($id: ID!) {', '  order(id: $id) { id }', '}'].join('\n');
    const fields = ['fragment OrderFields on Order {', '  id', '  total', '}'].join('\n');
    const unknown = project({ 'orders.graphql': orders, 'fields.graphql': fields, 'page.ts': "import OrdersDoc from './orders.graphql';\nuseQuery(OrdersDoc);" });
    const declared = project({
      'orders.graphql': orders,
      'fields.graphql': fields,
      'graphql.d.ts': "declare module '*.graphql' { const document: unknown; export default document; }",
      'page.ts': "import OrdersDoc from './orders.graphql';\nuseQuery(OrdersDoc);",
    });
    for (const made of [unknown, declared]) {
      const reading = readAt(made, 'page.ts', 'useQuery');
      const meta = metaOf(reading);
      expect(meta.document).toEqual({ file: 'orders.graphql', line: 3 });
      expect(placed(meta.fields, meta.document.file)).toEqual(['orders orders.graphql:4', 'id fields.graphql:2', 'total fields.graphql:3']);
      expect(operationsOf(reading.document, reading.fragments)[0]?.missingFragments).toEqual([]);
    }
  });

  it('reads a name imported from a .graphql file as the operation of that name', () => {
    const made = project({
      'orders.graphql': 'query Orders { orders { id } }\nquery Order($id: ID!) { order(id: $id) { id } }',
      'page.ts': "import { Order } from './orders.graphql';\nuseQuery(Order);",
    });
    const reading = readAt(made, 'page.ts', 'useQuery');
    expect(operationsOf(reading.document).map((operation) => operation.name)).toEqual(['Order']);
    expect(metaOf(reading).document).toEqual({ file: 'orders.graphql', line: 2 });
  });

  it('reads a document codegen generated, printed back from its AST, casts and all', () => {
    const made = project({
      'gql.ts': 'export const OrdersDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"Orders"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","alias":{"kind":"Name","value":"all"},"name":{"kind":"Name","value":"orders"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"first"},"value":{"kind":"IntValue","value":"5"}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}}]}}]}}]} as unknown as DocumentNode;',
      'use.ts': "import { OrdersDocument } from './gql';\nuseQuery(OrdersDocument);",
    });
    const reading = documentOf(callsIn(made, 'use.ts', 'useQuery')[0]?.getArguments()[0]);
    expect(reading.kind).toBe('read');
    if (reading.kind !== 'read') return;
    expect(operationsOf(reading.document)[0]?.fields[0]).toMatchObject({ field: 'orders', alias: 'all', arguments: ['first'] });
  });

  it('says a document built at run time is one, and never guesses what it asks', () => {
    const made = project({ 'dyn.ts': "const fields = ['id'];\nuseQuery(gql(`query { orders { ${fields.join(' ')} } }`));\nuseQuery(gql('query { ' + fields[0] + ' }'));" });
    const [first, second] = callsIn(made, 'dyn.ts', 'useQuery');
    expect(documentOf(first?.getArguments()[0]).kind).toBe('dynamic');
    expect(documentOf(second?.getArguments()[0]).kind).toBe('dynamic');
  });
});

describe('the calls that send an operation (P232)', () => {
  const made = project({
    'client.ts': [
      "import { useQuery as useApollo } from '@apollo/client';",
      "import { useQuery } from 'urql';",
      "import { request, GraphQLClient } from 'graphql-request';",
      'const DOC = gql`{ orders { id } }`;',
      'useApollo(DOC);',
      'useQuery({ query: DOC });',
      "request('https://orders/graphql', DOC);",
      "const client = new GraphQLClient('https://catalog/graphql');",
      'client.request(DOC);',
      'apolloClient.mutate({ mutation: DOC });',
      "db.query('select * from orders');",
      "fetch('/graphql', { method: 'POST', body: JSON.stringify({ query: DOC }) });",
    ].join('\n'),
  });
  const all = made.getSourceFile('client.ts')?.getDescendantsOfKind(SyntaxKind.CallExpression) ?? [];
  const at = (text: string) => graphqlCallOf(all.find((call) => call.getText().startsWith(text)) as CallExpression);

  it('recognises each client by what it is imported from and what it is handed', () => {
    expect(at('useApollo(')?.library).toBe('apollo');
    expect(at('useQuery({')?.library).toBe('urql');
    expect(at("request('")).toMatchObject({ library: 'graphql-request' });
    expect(at("request('")?.endpoint?.getText()).toBe("'https://orders/graphql'");
    expect(at('client.request(')?.endpoint?.getText()).toBe("'https://catalog/graphql'");
    expect(at('apolloClient.mutate(')?.library).toBe('apollo');
    expect(at("fetch('/graphql'")?.library).toBe('fetch');
  });

  it('leaves alone a query that is not GraphQL', () => {
    expect(at("db.query('")).toBeUndefined();
  });
});

describe('what a server declares (P232)', () => {
  it('reads NestJS resolvers, code-first: root fields by name or by option, field resolvers on the resolved type', () => {
    const made = project({
      'order.ts': "import { Field, ObjectType } from '@nestjs/graphql';\n@ObjectType()\nexport class Order {\n  @Field()\n  id: string;\n}",
      'orders.resolver.ts': [
        "import { Args, Query, Mutation, ResolveField, Resolver } from '@nestjs/graphql';",
        "import { Order } from './order';",
        '@Resolver(() => Order)',
        'export class OrdersResolver {',
        '  @Query(() => [Order])',
        "  orders(@Args('status', { nullable: true }) status?: string) { return []; }",
        "  @Query(() => Order, { name: 'order' })",
        "  findOne(@Args('id') id: string) { return null; }",
        '  @Mutation(() => Order)',
        '  placeOrder() { return null; }',
        '  @ResolveField(() => String)',
        '  customer() { return null; }',
        '}',
      ].join('\n'),
      'app.module.ts': "GraphQLModule.forRoot({ autoSchemaFile: true, path: '/api/graphql' });",
    });
    const reading = readGraphqlServer(made.getSourceFiles(), { schemaFiles: [], dependencies: new Set(['@nestjs/graphql']) });
    expect(reading.fields.map((field) => [field.type, field.field, field.root, field.returns])).toEqual([
      ['Query', 'orders', true, '[Order!]!'],
      ['Query', 'order', true, 'Order!'],
      ['Mutation', 'placeOrder', true, 'Order!'],
      ['Order', 'customer', false, 'String!'],
    ]);
    expect(reading.fields[0]?.args).toEqual({ status: { type: 'String', required: false } });
    expect(reading.endpoint).toBe('/api/graphql');
    expect(reading.schema.types['Order']?.fields?.['id']?.type).toBe('String!');
  });

  it('reads a resolver declared by a decorator of the repository that applies @Resolver (R180)', () => {
    const made = project({
      'order.ts': "import { Field, ObjectType } from '@nestjs/graphql';\n@ObjectType()\nexport class Order {\n  @Field()\n  id: string;\n}",
      'scoped-resolver.ts': [
        "import { applyDecorators, SetMetadata } from '@nestjs/common';",
        "import { Resolver } from '@nestjs/graphql';",
        "export const StaffResolver = (of?: () => unknown) => applyDecorators(of ? Resolver(of) : Resolver(), SetMetadata('scope', 'admin'));",
        'export function ShopResolver(of: () => unknown) { return StaffResolver(of); }',
        "export const Unrelated = () => SetMetadata('scope', 'none');",
      ].join('\n'),
      'orders.resolver.ts': [
        "import { Query, ResolveField } from '@nestjs/graphql';",
        "import { StaffResolver, ShopResolver, Unrelated } from './scoped-resolver';",
        "import { Order } from './order';",
        '@StaffResolver(() => Order)',
        'export class OrdersResolver {',
        '  @Query(() => [Order])',
        '  orders() { return []; }',
        '  @ResolveField(() => String)',
        '  customer() { return null; }',
        '}',
        '@StaffResolver()',
        'export class StatusResolver {',
        '  @Query(() => String)',
        "  status() { return 'ok'; }",
        '}',
        '@ShopResolver(() => Order)',
        'export class TotalsResolver {',
        '  @ResolveField(() => Number)',
        '  total() { return 0; }',
        '}',
        '@Unrelated()',
        'export class NotAResolver {',
        '  @Query(() => String)',
        "  hidden() { return ''; }",
        '}',
      ].join('\n'),
    });
    const reading = readGraphqlServer(made.getSourceFiles(), { schemaFiles: [], dependencies: new Set(['@nestjs/graphql']) });
    expect(reading.fields.map((field) => `${field.type}.${field.field}`)).toEqual([
      'Query.orders',
      'Order.customer',
      'Query.status',
      'Order.total',
    ]);
  });

  it('reads the name, type and nullability an argument\'s options give, before or after its name', () => {
    const made = project({
      'order.ts': "import { Field, ObjectType, ID } from '@nestjs/graphql';\n@ObjectType()\nexport class Order {\n  @Field(() => ID)\n  id: string;\n}",
      'orders.resolver.ts': [
        "import { Args, Query, Resolver, ID, Int } from '@nestjs/graphql';",
        "import { Order } from './order';",
        '@Resolver(() => Order)',
        'export class OrdersResolver {',
        '  @Query(() => Order)',
        "  order(@Args({ name: 'id', type: () => ID }) id: string) { return null; }",
        '  @Query(() => [Order])',
        "  orders(@Args('take', { type: () => Int }) take: number, @Args({ name: 'tags', type: () => [String], nullable: true }) tags?: string[]) { return []; }",
        '  @Query(() => [Order])',
        "  recent(@Arg('since', () => Int) since: number) { return []; }",
        '}',
      ].join('\n'),
    });
    const reading = readGraphqlServer(made.getSourceFiles(), { schemaFiles: [], dependencies: new Set(['@nestjs/graphql']) });
    expect(reading.schema.types['Query']?.fields).toEqual({
      order: { type: 'Order!', args: { id: { type: 'ID!', required: true } } },
      orders: { type: '[Order!]!', args: { take: { type: 'Int!', required: true }, tags: { type: '[String!]', required: false } } },
      recent: { type: '[Order!]!', args: { since: { type: 'Int!', required: true } } },
    });
  });

  it('keeps the arguments the SDL declares for a root field whose resolver names none', () => {
    const made = project({
      'orders.resolver.ts': [
        "import { Args, Query, Resolver } from '@nestjs/graphql';",
        "const typeDefs = gql`type Order { id: ID! } type Query { order(id: ID!): Order }`;",
        'new ApolloServer({ typeDefs });',
        '@Resolver()',
        'export class OrdersResolver {',
        '  @Query(() => Order)',
        '  order(@Context() context: unknown) { return null; }',
        '}',
      ].join('\n'),
    });
    const reading = readGraphqlServer(made.getSourceFiles(), { schemaFiles: [], dependencies: new Set(['@nestjs/graphql']) });
    expect(reading.schema.types['Query']?.fields?.['order']).toEqual({ type: 'Order!', args: { id: { type: 'ID!', required: true } } });
    expect(reading.fields[0]?.args).toEqual({ id: { type: 'ID!', required: true } });
  });

  it('follows a resolver map through constants, spreads and imports, with the SDL beside it', () => {
    const made = project({
      'product.ts': 'export const productFields = { reviews: () => [] };',
      'resolvers.ts': "import { productFields } from './product';\nconst queries = { products: () => [], product(_: unknown, args: { id: string }) { return null; } };\nexport const resolvers = { Query: queries, Product: { ...productFields } };",
      'index.ts': "import { resolvers } from './resolvers';\nconst typeDefs = gql`type Query { products: [Product!]! product(id: ID!): Product } type Product { id: ID! reviews: [String!]! }`;\nconst server = new ApolloServer({ typeDefs, resolvers });\nstartStandaloneServer(server);",
    });
    const reading = readGraphqlServer(made.getSourceFiles(), { schemaFiles: [], dependencies: new Set(['@apollo/server']) });
    expect(reading.fields.map((field) => `${field.type}.${field.field}`).sort()).toEqual(['Product.reviews', 'Query.product', 'Query.products']);
    expect(reading.fields.find((field) => field.field === 'product')?.args).toEqual({ id: { type: 'ID!', required: true } });
    expect(reading.endpoint).toBe('/');
    expect(reading.federated).toBe(false);
  });

  it('says a subgraph is one', () => {
    const made = project({ 'index.ts': 'const typeDefs = gql`type Order @key(fields: "id") { id: ID! } type Query { orders: [Order!]! }`;\nnew ApolloServer({ schema: buildSubgraphSchema({ typeDefs, resolvers: { Query: { orders: () => [] } } }) });' });
    expect(readGraphqlServer(made.getSourceFiles(), { schemaFiles: [], dependencies: new Set() }).federated).toBe(true);
  });
});

describe('a server made into a function a platform invokes (P269)', () => {
  const files = {
    'books.ts': 'export const bookResolvers = { Query: { book: async () => null, books: () => [] }, Mutation: { addBook: async () => null } };',
    'authors.ts': 'const author = async () => null;\nexport const authorResolvers = { Query: { author } };',
    'resolvers.ts': [
      "import { bookResolvers } from './books';",
      "import { authorResolvers } from './authors';",
      'export const resolvers = { Query: { ...bookResolvers.Query, ...authorResolvers.Query }, Mutation: { ...bookResolvers.Mutation } };',
    ].join('\n'),
    'index.ts': [
      "import { ApolloServer, gql } from 'apollo-server-lambda';",
      "import { resolvers } from './resolvers';",
      'const typeDefs = gql`type Query { book: String books: [String] author: String } type Mutation { addBook: String }`;',
      'export const server = new ApolloServer({ resolvers, typeDefs }).createHandler();',
    ].join('\n'),
  };

  it('reads a map put together a type at a time out of other maps, and a resolver handed by its name', () => {
    const reading = readGraphqlServer(project(files).getSourceFiles(), { schemaFiles: [], dependencies: new Set(['apollo-server-lambda']) });
    expect(reading.fields.map((field) => `${field.type}.${field.field}`).sort()).toEqual(['Mutation.addBook', 'Query.author', 'Query.book', 'Query.books']);
  });

  it('says the server answers at no path of its own, and which server a handler export is', () => {
    const made = project(files);
    const reading = readGraphqlServer(made.getSourceFiles(), { schemaFiles: [], dependencies: new Set(['apollo-server-lambda']) });
    expect(reading.asFunction).toBe(true);
    const exported = made.getSourceFile('index.ts')?.getVariableDeclaration('server')?.getInitializer();
    expect(graphqlServerHandled(exported)?.getText()).toBe('new ApolloServer({ resolvers, typeDefs })');
    // A server listening on a path of its own is not one.
    const listening = project({ 'index.ts': "const server = new ApolloServer({ typeDefs: gql`type Query { a: String }` });\napp.use('/graphql', expressMiddleware(server));" });
    expect(readGraphqlServer(listening.getSourceFiles(), { schemaFiles: [], dependencies: new Set() }).asFunction).toBe(false);
  });

  it('reads the server handed to the integration that makes it a Lambda handler', () => {
    const made = project({
      'index.ts': [
        "import { ApolloServer } from '@apollo/server';",
        "import { startServerAndCreateLambdaHandler, handlers } from '@as-integrations/aws-lambda';",
        'const server = new ApolloServer({ typeDefs: `type Query { a: String }` });',
        'export const graphqlHandler = startServerAndCreateLambdaHandler(server, handlers.createAPIGatewayProxyEventRequestHandler());',
        'export const other = startServerAndCreateLambdaHandler(makeServer(), handlers.createAPIGatewayProxyEventRequestHandler());',
      ].join('\n'),
    });
    const file = made.getSourceFile('index.ts');
    expect(graphqlServerHandled(file?.getVariableDeclaration('graphqlHandler')?.getInitializer())).toBeDefined();
    expect(graphqlServerHandled(file?.getVariableDeclaration('other')?.getInitializer())).toBeUndefined();
  });
});

describe('a document a server posts with fetch, written with its values in it (P279)', () => {
  const files = {
    'orders.ts': [
      "import fetch from 'node-fetch';",
      'export async function place(name: string, total: number) {',
      '  const body = {',
      '    query: `mutation {',
      '      placeOrder(name: "${name}", total: ${total}) {',
      '        id',
      '      }',
      '    }`,',
      '  };',
      "  await fetch(ENDPOINT, { method: 'POST', body: JSON.stringify(body) });",
      '}',
      'export async function status(id: string, state: string) {',
      "  await fetch(ENDPOINT, { method: 'POST', body: JSON.stringify({ query: `mutation {\\n  setStatus(id: ${id}, status: ${state}) {\\n    id\\n  }\\n}` }) });",
      '}',
      'export async function search(term: string) {',
      "  await fetch(ENDPOINT, { method: 'POST', body: JSON.stringify({ query: term }) });",
      '}',
      'export async function built(fields: string) {',
      "  await fetch(ENDPOINT, { method: 'POST', body: JSON.stringify({ query: `query { order { ${fields} } }` }) });",
      '}',
    ].join('\n'),
  };

  it('reads the operation through node-fetch, a body held in a const, and a value written bare where an argument goes', () => {
    const made = project(files);
    const [place, status, search, built] = callsIn(made, 'orders.ts', 'fetch');
    const placed = graphqlCallOf(place as CallExpression);
    expect(placed?.library).toBe('fetch');
    const reading = documentOf(placed?.document);
    expect(reading.kind).toBe('read');
    if (reading.kind !== 'read') return;
    expect(metaOf(reading).fields?.map((field) => field.field)).toEqual(['placeOrder']);
    expect(metaOf(reading).fields?.[0]?.line).toBe(5);
    // A line break written as an escape is one.
    const statusReading = documentOf(graphqlCallOf(status as CallExpression)?.document);
    expect(statusReading.kind === 'read' ? metaOf(statusReading).fields?.map((field) => field.field) : statusReading.why).toEqual(['setStatus']);
    // A search term is not a GraphQL request.
    expect(graphqlCallOf(search as CallExpression)).toBeUndefined();
    // A document whose selection is built at run time is one, unread, with a reason.
    const unread = graphqlCallOf(built as CallExpression);
    expect(unread?.library).toBe('fetch');
    expect(documentOf(unread?.document).kind).toBe('dynamic');
  });

  it('takes Apollo Client by the options it is handed, whatever its document', () => {
    const made = project({
      'records.ts': [
        'export const merge = (client: any, mutation: unknown) => client.mutate({ mutation, variables: { ids: [] } });',
        'export const list = (client: any, query: unknown) => client.query({ query, variables: { limit: 10 } });',
        'export const raw = (db: any, query: string) => db.query({ query });',
      ].join('\n'),
    });
    const calls = made.getSourceFile('records.ts')?.getDescendantsOfKind(SyntaxKind.CallExpression) ?? [];
    expect(calls.map((call) => graphqlCallOf(call)?.library ?? 'none')).toEqual(['apollo', 'apollo', 'none']);
  });
});
