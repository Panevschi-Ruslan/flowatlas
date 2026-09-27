import { DECLARED_CONFIDENCE, type GraphEdge } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { DocumentError } from '../document/declared.js';
import { readAsyncapiDocument } from './read.js';

const read = (raw: unknown) =>
  readAsyncapiDocument(raw, {
    service: 'billing',
    documentPath: 'contracts/billing.asyncapi.json',
    generatedAt: '2026-01-01T00:00:00.000Z',
  });

/** Version 3: operations beside the channels, pointing in, address in a field. */
const v3 = {
  asyncapi: '3.0.0',
  channels: {
    ordersCreated: {
      address: 'orders.created',
      messages: { OrderCreated: { $ref: '#/components/messages/OrderCreated' } },
    },
    invoiceIssued: { address: 'invoice.issued' },
  },
  operations: {
    onOrderCreated: {
      action: 'receive',
      channel: { $ref: '#/channels/ordersCreated' },
      messages: [{ $ref: '#/channels/ordersCreated/messages/OrderCreated' }],
    },
    issueInvoice: {
      action: 'send',
      channel: { $ref: '#/channels/invoiceIssued' },
      messages: [{ $ref: '#/components/messages/InvoiceIssued' }],
    },
  },
  components: {
    messages: {
      OrderCreated: { payload: { $ref: '#/components/schemas/OrderCreated' } },
      InvoiceIssued: { payload: { $ref: '#/components/schemas/InvoiceIssued' } },
    },
    schemas: {
      OrderCreated: {
        type: 'object',
        required: ['orderId'],
        properties: { orderId: { type: 'string' } },
      },
      InvoiceIssued: {
        type: 'object',
        required: ['invoiceId'],
        properties: { invoiceId: { type: 'string' } },
      },
    },
  },
};

/** Version 2: the same two ends, written the other containment. */
const v2 = {
  asyncapi: '2.6.0',
  channels: {
    'orders.created': {
      description: 'Not an operation.',
      publish: {
        operationId: 'onOrderCreated',
        message: { payload: { $ref: '#/components/schemas/OrderCreated' } },
      },
    },
    'invoice.issued': {
      subscribe: {
        operationId: 'issueInvoice',
        message: { payload: { $ref: '#/components/schemas/InvoiceIssued' } },
      },
    },
  },
  components: { schemas: v3.components.schemas },
};

const edge = (edges: readonly GraphEdge[], type: string): GraphEdge | undefined =>
  edges.find((each) => each.type === type);

describe('an AsyncAPI document, read', () => {
  it('lands a channel on the id a repository that was read would land on', () => {
    // The whole argument of the ticket. No repository half, so a producer read
    // out of source and this consumer meet on one node with nothing joining them.
    const { graph } = read(v3);
    expect(graph.nodes.filter((node) => node.type === 'channel').map((node) => node.id).sort()).toEqual([
      'channel:invoice.issued',
      'channel:orders.created',
    ]);
  });

  it('takes the address rather than the key a document files a channel under', () => {
    // The indirection, and the one thing a key-based reader gets silently wrong:
    // `ordersCreated` is a name internal to the document and nothing publishes
    // to it, so a graph holding it would join nothing and look complete.
    const { graph } = read(v3);
    expect(graph.nodes.some((node) => node.id === 'channel:ordersCreated')).toBe(false);
  });

  it('reads both containments into the same graph', () => {
    // Version 2 puts the operation inside the channel, version 3 beside it. The
    // ends are the same ends, which is what makes one of them a walk and not a
    // second reader.
    const shape = (raw: unknown) =>
      read(raw)
        .graph.edges.filter((each) => each.type === 'emits' || each.type === 'consumes')
        .map((each) => `${each.type} ${each.from} ${each.to}`)
        .sort();
    expect(shape(v2)).toEqual(shape(v3));
  });

  it('reads version 2 publish as receiving and subscribe as sending', () => {
    // Not a typo and not a synonym. Version 2 named an operation after what
    // somebody else may do to the channel, so `publish` means this service
    // receives; version 3 renamed the pair to `receive` and `send` for exactly
    // that reason. A reader that took the words at face value would draw every
    // declared channel backwards, and a backwards channel still joins and still
    // compares — it reports the producer's shape as the consumer's.
    const { graph } = read(v2);
    expect(edge(graph.edges, 'consumes')?.from).toBe('channel:orders.created');
    expect(edge(graph.edges, 'emits')?.to).toBe('channel:invoice.issued');
  });

  it('follows a chain of message references to the payload', () => {
    // An operation points at the channel's message and the channel's message
    // points at the one under `components`. Following one link found the
    // reference instead of the payload, and the end compared against nothing
    // while looking complete.
    const { graph } = read(v3);
    expect(edge(graph.edges, 'emits')?.params).toEqual(['type:billing#InvoiceIssued']);
    const handles = graph.edges.filter((each) => each.type === 'handles' && each.params !== undefined);
    expect(handles[0]?.params).toEqual(['type:billing#OrderCreated']);
  });

  it('reads several messages on one channel as the choice they are', () => {
    const { graph } = read({
      asyncapi: '2.6.0',
      channels: {
        'orders.created': {
          subscribe: {
            operationId: 'send',
            message: {
              oneOf: [
                { payload: { type: 'object', properties: { a: { type: 'string' } } } },
                { payload: { $ref: '#/components/schemas/OrderCreated' } },
              ],
            },
          },
        },
      },
      components: { schemas: v3.components.schemas },
    });
    expect(edge(graph.edges, 'emits')?.params?.[0]).toContain(' | ');
  });

  it('puts the payload where the check looks for a consumer shape', () => {
    // `boundaries()` finds a consumer's shape by going to the entry point the
    // consumer answers, which is where a repository puts it. A declared consumer
    // without that entry compares against nothing and reads as complete.
    const { graph } = read(v3);
    const consumer = graph.nodes.find((node) => node.type === 'consumer');
    const entryId = consumer?.meta?.['entryId'];
    expect(entryId).toBe('entry:billing:event:orders.created');
    const handles = graph.edges.find((each) => each.type === 'handles' && each.from === entryId);
    expect(handles?.meta?.['body']).toBe('type:billing#OrderCreated');
  });

  it('marks everything it produced as declared, and the channel as nobody, and says by what', () => {
    const { graph } = read(v3);
    expect(graph.edges.every((each) => each.confidence === DECLARED_CONFIDENCE)).toBe(true);
    for (const node of graph.nodes) {
      const declaredBy = node.meta?.['declaredBy'];
      // The channel is the whole project's, so claiming a document declared it
      // would be false the moment a repository that was read names the address.
      if (node.type === 'channel') expect(declaredBy).toBeUndefined();
      else expect(declaredBy).toBe('contracts/billing.asyncapi.json');
    }
    expect(graph.meta?.['declaredBy']).toBe('contracts/billing.asyncapi.json');
  });

  it('passes over an operation pointing at a channel that is not there', () => {
    const { graph, declared } = read({
      asyncapi: '3.0.0',
      channels: {},
      operations: { gone: { action: 'send', channel: { $ref: '#/channels/missing' } } },
    });
    expect(declared).toBe(0);
    expect(graph.nodes).toEqual([]);
  });

  it('passes over the keys of a channel that are not operations', () => {
    const { declared } = read({
      asyncapi: '2.6.0',
      channels: { 'orders.created': { description: 'x', parameters: {}, bindings: {} } },
    });
    expect(declared).toBe(0);
  });

  it('refuses a document that is not an object at all', () => {
    // Thrown rather than reported: a service with no channels reads exactly like
    // a service that has none, and the difference is the whole feature.
    expect(() => read('billing')).toThrow(DocumentError);
  });
});
