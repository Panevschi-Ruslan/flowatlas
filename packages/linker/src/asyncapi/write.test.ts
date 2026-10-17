import { lookupOf } from '@flowatlas/contracts';
import { describe, expect, it } from 'vitest';
import { specGraph } from '../document/__fixtures__/spec-graph.js';
import { verifyWritten } from '../document/verify.js';
import { specFragment, findOperations } from '../document/fragment.js';
import { readAsyncapiDocument } from './read.js';
import { writeAsyncapiDocument } from './write.js';

const lookup = lookupOf(specGraph());

describe('writeAsyncapiDocument (P118)', () => {
  it('writes a send operation for every publish, on the channel by its address', () => {
    const written = writeAsyncapiDocument(lookup, 'orders')!;
    expect(written.document).toMatchObject({
      asyncapi: '3.0.0',
      channels: {
        'order.created': {
          address: 'order.created',
          messages: { 'send.order.created': { $ref: '#/components/messages/send.order.created' } },
          'x-flowatlas-channel-kind': 'topic',
        },
      },
      operations: {
        'send.order.created': {
          action: 'send',
          channel: { $ref: '#/channels/order.created' },
          messages: [{ $ref: '#/channels/order.created/messages/send.order.created' }],
          summary: 'OrdersService.create',
          'x-flowatlas-source': 'src/orders.service.ts:22',
          'x-flowatlas-confidence': 'static',
          'x-flowatlas-consumers': { billing: 1 },
        },
      },
    });
    const components = written.document['components'] as { messages: Record<string, unknown>; schemas: Record<string, unknown> };
    expect(components.messages['send.order.created']).toEqual({ name: 'send.order.created', payload: { $ref: '#/components/schemas/OrderCreated' } });
    expect(components.schemas['OrderCreated']).toMatchObject({ properties: { placedAt: { type: 'string', format: 'date-time' } } });
    expect(written.operations.map((operation) => operation.key)).toEqual(['send order.created']);
  });

  it('writes a receive operation with the shape its handler takes', () => {
    const written = writeAsyncapiDocument(lookup, 'billing')!;
    expect(written.operations.map((operation) => `${operation.key} <- ${operation.callers.map((caller) => caller.service).join(',')}`)).toEqual([
      'receive order.created <- orders',
      'send sqs/receipts <- mailer',
    ]);
    expect(Object.keys(written.document['channels'] as object)).toEqual(['order.created', 'sqs_receipts']);
  });

  it('writes what a delivery hands over as the message inside it, and the wrapping beside it (R172)', () => {
    const written = writeAsyncapiDocument(lookup, 'mailer')!;
    const operation = (written.document['operations'] as Record<string, Record<string, unknown>>)['receive.sqs_receipts']!;
    expect(operation['x-flowatlas-envelope']).toEqual({ path: 'Records[].body', text: true });
    const message = (written.document['components'] as { messages: Record<string, unknown> }).messages['receive.sqs_receipts'];
    expect(message).toEqual({ name: 'receive.sqs_receipts', payload: { $ref: '#/components/schemas/Receipt' } });
  });

  it('reads back through the reader into the same channel ends (D3)', () => {
    for (const service of ['orders', 'billing', 'mailer']) {
      const written = writeAsyncapiDocument(lookup, service)!;
      expect(verifyWritten(written), service).toEqual([]);
    }
    const read = readAsyncapiDocument(writeAsyncapiDocument(lookup, 'orders')!.document, { service: 'orders', documentPath: 'orders.asyncapi.yaml' });
    expect(read.graph.edges.find((edge) => edge.type === 'emits')?.params).toEqual(['type:orders#OrderCreated']);
  });

  it('writes nothing for a service with no channel end', () => {
    expect(writeAsyncapiDocument(lookup, 'gateway')).toBeUndefined();
  });

  it('hands on one operation with what it refers to', () => {
    const written = writeAsyncapiDocument(lookup, 'orders')!;
    const [operation] = findOperations(written, 'send order.created');
    const fragment = specFragment(written, operation!);
    expect(Object.keys(fragment)).toEqual(['asyncapi', 'operations', 'channels', 'components']);
    expect(Object.keys((fragment['components'] as { schemas: object }).schemas)).toEqual(['OrderCreated']);
    expect(findOperations(written, 'order.created')).toHaveLength(1);
  });
});
