import { describe, expect, it } from 'vitest';
import { operationsOf, reachedFields } from './operations.js';
import { GraphqlSyntaxError, parseDocument, tryParse, typeText } from './parse.js';
import { schemaOf } from './schema.js';

const SDL = `
  """The shop's schema."""
  schema { query: Query mutation: Mutation }
  interface Node { id: ID! }
  type Order implements Node @key(fields: "id") {
    id: ID!
    total: Float
    customer: Customer!
    lines(first: Int = 10): [Line!]!
  }
  type Customer implements Node { id: ID! name: String! }
  type Line { sku: String! }
  union Result = Order | Customer
  enum Status { OPEN CLOSED }
  input PlaceOrder { customerId: ID! note: String }
  type Query { orders(status: Status): [Order!]! node(id: ID!): Node }
  type Mutation { placeOrder(input: PlaceOrder!): Order! }
  extend type Query { search(term: String!): [Result!]! }
`;

describe('the GraphQL language, read (P232)', () => {
  it('makes a schema of type definitions, extensions merged and types written as GraphQL writes them', () => {
    const schema = schemaOf([parseDocument(SDL)]);
    expect(schema.roots).toEqual({ query: 'Query', mutation: 'Mutation' });
    expect(schema.types['Query']?.fields).toMatchObject({
      orders: { type: '[Order!]!', args: { status: { type: 'Status', required: false } } },
      node: { type: 'Node', args: { id: { type: 'ID!', required: true } } },
      search: { type: '[Result!]!' },
    });
    expect(schema.types['Order']?.fields?.['lines']?.args).toEqual({ first: { type: 'Int', required: false } });
    expect(schema.types['Order']?.directives).toEqual(['key']);
    expect(schema.types['Node']?.possible).toEqual(['Customer', 'Order']);
    expect(schema.types['Result']?.possible).toEqual(['Customer', 'Order']);
    expect(schema.types['PlaceOrder']?.fields).toEqual({ customerId: { type: 'ID!' }, note: { type: 'String' } });
  });

  it('reads an operation with aliases, variables, fragments and inline fragments put in place', () => {
    const document = parseDocument(`
      query Orders($status: Status, $id: ID!) {
        open: orders(status: $status) { ...OrderFields customer { name } }
        node(id: $id) { ... on Order { total } ... on Customer { name } }
      }
      fragment OrderFields on Order { id total }
    `);
    const [operation] = operationsOf(document);
    expect(operation).toMatchObject({ operation: 'query', name: 'Orders', missingFragments: [] });
    expect(operation?.variables).toEqual([
      { name: 'status', type: 'Status', required: false },
      { name: 'id', type: 'ID!', required: true },
    ]);
    const [orders, node] = operation?.fields ?? [];
    expect(orders).toMatchObject({ field: 'orders', alias: 'open', arguments: ['status'] });
    expect(orders?.selections.map((each) => [each.field, each.on])).toEqual([
      ['id', 'Order'],
      ['total', 'Order'],
      ['customer', undefined],
    ]);
    expect(node?.selections.map((each) => [each.field, each.on])).toEqual([
      ['total', 'Order'],
      ['name', 'Customer'],
    ]);
  });

  it('names the fields a selection reaches in the schema, and the ones the schema does not have', () => {
    const schema = schemaOf([parseDocument(SDL)]);
    const [operation] = operationsOf(parseDocument('{ orders { id custmer { name } customer { name nickname } } }'));
    const reached = reachedFields(schema, 'Query', operation?.fields ?? []);
    expect(reached.map((each) => [each.path, each.type, each.known])).toEqual([
      ['orders', 'Query', true],
      ['orders.id', 'Order', true],
      ['orders.custmer', 'Order', false],
      ['orders.customer', 'Order', true],
      ['orders.customer.name', 'Customer', true],
      ['orders.customer.nickname', 'Customer', false],
    ]);
  });

  it('says which fragment a document spreads and does not define', () => {
    const [operation] = operationsOf(parseDocument('query { orders { ...Elsewhere id } }'));
    expect(operation?.missingFragments).toEqual(['Elsewhere']);
  });

  it('stops at what is not GraphQL, naming the offset', () => {
    expect(() => parseDocument('query { orders { id }')).toThrow(GraphqlSyntaxError);
    // SQL handed to a client's `query` is not mistaken for a document: it stops at the first character GraphQL has no use for.
    expect(() => parseDocument('SELECT * FROM orders')).toThrow(expect.objectContaining({ at: 7 }));
  });

  it('reads a block string holding three quotes escaped, as a description and as a value', () => {
    const document = parseDocument('"""Say \\""" twice."""\ntype Query { note(text: String): String }\nquery { note(text: """a \\""" b""") }');
    expect(document.definitions.map((definition) => definition.kind)).toEqual(['type', 'operation']);
    const query = document.definitions[1];
    const note = query?.kind === 'operation' ? query.selections[0] : undefined;
    // A value is kept as written.
    expect(note?.kind === 'field' ? note.arguments[0] : undefined).toMatchObject({ name: 'text', value: '"""a \\""" b"""' });
    expect(() => parseDocument('type Query { a: Int } """open \\"""')).toThrow(GraphqlSyntaxError);
  });

  it('refuses nesting deeper than any document is written as a syntax error, not a stack overflow', () => {
    const deep = 20_000;
    expect(tryParse(`query ${'{ a '.repeat(deep)}${'}'.repeat(deep)}`)).toBeUndefined();
    expect(tryParse(`query { a(x: ${'['.repeat(deep)}${']'.repeat(deep)}) }`)).toBeUndefined();
    expect(tryParse(`query ($x: ${'['.repeat(deep)}Int${']'.repeat(deep)}) { a }`)).toBeUndefined();
    expect(tryParse(`type Query { a: ${'['.repeat(deep)}Int${']'.repeat(deep)} }`)).toBeUndefined();
    // Nesting a person writes still reads.
    expect(tryParse(`query ${'{ a '.repeat(100)}${'}'.repeat(100)}`)).toBeDefined();
  });

  it('writes a type back as GraphQL does', () => {
    const [query] = schemaOf([parseDocument('type Query { a: [[Int!]]! }')]).types['Query']?.fields?.['a']?.type.split(' ') ?? [];
    expect(query).toBe('[[Int!]]!');
    expect(typeText({ kind: 'nonNull', of: { kind: 'list', of: { kind: 'named', name: 'ID' } } })).toBe('[ID]!');
  });
});
