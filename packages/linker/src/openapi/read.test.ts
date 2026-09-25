import { describe, expect, it } from 'vitest';
import { OpenapiDocumentError, readOpenapiDocument } from './read.js';

/**
 * A document, read as a graph.
 *
 * Every claim here is about what an OpenAPI document says and what the model
 * already holds, so a failure names one or the other. The claim this file
 * exists for is the first one: the output is indistinguishable from a
 * repository's graph everywhere except in the one place that must never be
 * indistinguishable, which is who is being believed.
 */

const read = (document: unknown) =>
  readOpenapiDocument(document, { service: 'billing', documentPath: 'contracts/billing.json' });

const minimal = {
  openapi: '3.0.3',
  paths: {
    '/invoices/{invoiceId}': {
      get: {
        operationId: 'getInvoice',
        parameters: [{ name: 'invoiceId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Invoice' } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Invoice: {
        type: 'object',
        required: ['id', 'total'],
        properties: { id: { type: 'string' }, total: { type: 'number' }, note: { type: 'string' } },
      },
    },
  },
};

describe('a route taken from a document', () => {
  it('lands on the same entry id a repository would have produced', () => {
    // The whole of the join depends on this: the caller's side spells the id
    // from the address it read, and the two have to meet without either knowing
    // which kind of end the other is.
    const { graph } = read(minimal);
    expect(graph.nodes.map((node) => node.id)).toContain(
      'entry:billing:http:GET:/invoices/:param',
    );
  });

  it('puts a handler behind it, named after the operation', () => {
    const { graph } = read(minimal);
    const handler = graph.nodes.find((node) => node.type === 'method');
    expect(handler?.id).toBe('billing#contracts/billing.json:getInvoice');
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ from: 'entry:billing:http:GET:/invoices/:param', type: 'handles' }),
    );
  });

  it('names the path parameters the document spells', () => {
    const [entry] = read(minimal).graph.nodes;
    expect(entry?.meta?.['pathParams']).toEqual(['invoiceId']);
  });

  it('counts the routes it read', () => {
    expect(read(minimal).routes).toBe(1);
  });
});

describe('what says the facts were declared rather than read', () => {
  it('marks every edge as declared rather than proven', () => {
    // `static` is this model's word for what the type system proved. Nothing
    // here proved anything, and an edge that claimed otherwise would put a
    // third party's description of itself in the voice the tool uses for what
    // it has checked.
    const { graph } = read(minimal);
    expect(graph.edges.every((edge) => edge.confidence === 'declared')).toBe(true);
  });

  it('does not borrow the word for an annotation', () => {
    // R77. `marker` is what somebody wrote in source this tool can open, and a
    // reader filtering on it to find annotations to delete must not be handed a
    // service nobody here can edit.
    const { graph } = read(minimal);
    expect(graph.edges.some((edge) => edge.confidence === 'marker')).toBe(false);
  });

  it('names the document on every node and every edge', () => {
    const { graph } = read(minimal);
    const said = [...graph.nodes, ...graph.edges].map((each) => each.meta?.['declaredBy']);
    expect(said.every((each) => each === 'contracts/billing.json')).toBe(true);
  });

  it('records the document as where every shape was declared', () => {
    const { graph } = read(minimal);
    expect(graph.types['type:billing#Invoice']?.declaredIn).toBe('billing#contracts/billing.json');
  });
});

describe('schemas, as the registry holds them', () => {
  it('reads required and optional apart', () => {
    const invoice = read(minimal).graph.types['type:billing#Invoice'];
    expect(invoice?.fields?.map((field) => `${field.name}${field.optional ? '?' : ''}`)).toEqual([
      'id',
      'total',
      'note?',
    ]);
  });

  it('hashes a shape the same way an identical one read from source is hashed', () => {
    // Two declarations of one shape have to agree, whichever kind of source
    // each came from, or every declared boundary reads as drift on arrival.
    const invoice = read(minimal).graph.types['type:billing#Invoice'];
    expect(invoice?.structuralHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('collapses integer onto number, because JSON has one numeric type', () => {
    const { graph } = read({
      openapi: '3.0.3',
      paths: {},
      components: { schemas: { N: { type: 'object', properties: { n: { type: 'integer' } } } } },
    });
    expect(graph.types['type:billing#N']?.fields?.[0]?.type).toBe('number');
  });

  it('keeps a date as the string the wire actually carries', () => {
    // A repository declares `Date` and a wire rule has to work out that a
    // string arrives. A document says `string` and means it, which makes it the
    // better witness about the wire rather than a worse one.
    const { graph } = read({
      openapi: '3.0.3',
      paths: {},
      components: {
        schemas: { D: { type: 'object', properties: { at: { type: 'string', format: 'date-time' } } } },
      },
    });
    expect(graph.types['type:billing#D']?.fields?.[0]?.type).toBe('string');
  });

  it('reads an enumeration as the set of values it allows', () => {
    const { graph } = read({
      openapi: '3.0.3',
      paths: {},
      components: { schemas: { State: { type: 'string', enum: ['draft', 'paid'] } } },
    });
    expect(graph.types['type:billing#State']).toMatchObject({
      kind: 'enum',
      members: ["'draft'", "'paid'"],
    });
  });

  it('reads allOf as an intersection and oneOf as a choice', () => {
    const { graph } = read({
      openapi: '3.0.3',
      paths: {},
      components: {
        schemas: {
          A: { type: 'object', properties: { a: { type: 'string' } } },
          B: { type: 'object', properties: { b: { type: 'string' } } },
          Both: { type: 'object', properties: { x: { allOf: [{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }] } } },
          Either: { type: 'object', properties: { x: { oneOf: [{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }] } } },
        },
      },
    });
    expect(graph.types['type:billing#Both']?.fields?.[0]?.type).toBe(
      'type:billing#A & type:billing#B',
    );
    expect(graph.types['type:billing#Either']?.fields?.[0]?.type).toBe(
      'type:billing#A | type:billing#B',
    );
  });

  it('widens a nullable field to the null JSON really carries', () => {
    const { graph } = read({
      openapi: '3.0.3',
      paths: {},
      components: {
        schemas: { N: { type: 'object', properties: { n: { type: 'string', nullable: true } } } },
      },
    });
    expect(graph.types['type:billing#N']?.fields?.[0]?.type).toBe('string | null');
  });

  it('says nothing about a reference out of the document rather than inventing one', () => {
    const { graph } = read({
      openapi: '3.0.3',
      paths: {},
      components: {
        schemas: { N: { type: 'object', properties: { n: { $ref: 'other.json#/Thing' } } } },
      },
    });
    expect(graph.types['type:billing#N']?.fields?.[0]?.type).toBe('unknown');
  });
});

describe('bodies and answers', () => {
  const withBody = {
    openapi: '3.0.3',
    paths: {
      '/invoices': {
        post: {
          operationId: 'createInvoice',
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', required: ['amount'], properties: { amount: { type: 'number' } } },
              },
            },
          },
          responses: {
            '201': {
              description: 'made',
              content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string' } } } } },
            },
            '422': {
              description: 'refused',
              content: { 'application/json': { schema: { type: 'object', properties: { detail: { type: 'string' } } } } },
            },
          },
        },
      },
    },
  };

  it('names an inline body after the operation it belongs to', () => {
    const { graph } = read(withBody);
    const handles = graph.edges[0];
    expect(handles?.meta?.['body']).toBe('type:billing#CreateInvoiceBody');
    expect(graph.types['type:billing#CreateInvoiceBody']?.fields?.[0]?.name).toBe('amount');
  });

  it('compares the success answer and leaves the failure body alone', () => {
    // A caller's declared return type is about the success path. Comparing it
    // against a documented `422` would report drift on every route that
    // documents its failures well, which is the opposite of what one wants.
    const { graph } = read(withBody);
    expect(graph.edges[0]?.returns).toBe('type:billing#CreateInvoiceResponse');
    expect(graph.types['type:billing#CreateInvoiceResponse']?.fields?.[0]?.name).toBe('id');
  });

  it('reads no body at all from a media type that has no fields to compare', () => {
    const { graph } = read({
      openapi: '3.0.3',
      paths: {
        '/files': {
          post: {
            operationId: 'upload',
            requestBody: { content: { 'multipart/form-data': { schema: { type: 'object' } } } },
          },
        },
      },
    });
    expect(graph.edges[0]?.meta?.['body']).toBeUndefined();
  });
});

describe('a document that cannot be used', () => {
  it('refuses Swagger 2 by name rather than reading nothing out of it', () => {
    // It has `paths` and it parses, so reading it produces a service with no
    // routes — which is indistinguishable from a service that has none.
    expect(() => read({ swagger: '2.0', paths: {} })).toThrow(OpenapiDocumentError);
  });

  it('refuses something that is not an object at all', () => {
    expect(() => read('billing')).toThrow(OpenapiDocumentError);
  });

  it('reads a document with no paths as a service with no routes', () => {
    const { graph, routes } = read({ openapi: '3.0.3', paths: {} });
    expect(routes).toBe(0);
    expect(graph.nodes).toEqual([]);
  });
});

describe('what is not an operation', () => {
  it('leaves the keys of a path item that are not verbs alone', () => {
    const { graph } = read({
      openapi: '3.0.3',
      paths: {
        '/invoices': {
          summary: 'invoices',
          parameters: [],
          get: { operationId: 'list', responses: {} },
        },
      },
    });
    expect(graph.nodes.filter((node) => node.type === 'entry').map((node) => node.label)).toEqual([
      'GET /invoices',
    ]);
  });
});
