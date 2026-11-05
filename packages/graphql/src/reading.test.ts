import { Project, SyntaxKind, type CallExpression } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { graphqlCallOf } from './calls.js';
import { documentOf, lineInFile } from './documents.js';
import { operationsOf } from './operations.js';
import { readGraphqlServer } from './servers.js';

const project = (files: Record<string, string>): Project => {
  const made = new Project({ useInMemoryFileSystem: true, compilerOptions: { experimentalDecorators: true, jsx: 4 } });
  for (const [path, text] of Object.entries(files)) made.createSourceFile(path, text);
  return made;
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
