import { GRANTABLE_META, GRANTS_META, REACHES_META, STARTS_META, type GrantValue, type GraphEdge, type GraphNode, type Unresolved } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { boundByGrants } from './grant-link.js';
import { edgeKey } from './order.js';

/** Where a send goes that does not say, from what its function is granted (P272). */

const fn = (name: string, grants: GrantValue[]): GraphNode => ({
  id: `entry:relay:invoke:${name}`,
  type: 'entry',
  kind: 'invoke',
  label: name,
  repo: 'relay',
  meta: { name, [GRANTS_META]: grants },
});

const sender = (meta: Record<string, unknown> = {}): GraphNode => ({
  id: 'producer:relay#src/send.ts:9:3',
  type: 'producer',
  label: 'message ?',
  repo: 'relay',
  file: 'src/send.ts',
  line: 9,
  kind: 'message',
  meta: { kind: 'message', adapter: 'aws-sqs', channelKind: 'queue', [GRANTABLE_META]: [{ parts: ['sqs', { granted: 'queue' }], payload: 'type:relay#Order' }], ...meta },
});

const row = (producer: GraphNode): Unresolved => ({
  service: 'relay',
  file: 'src/send.ts',
  line: 9,
  reason: 'channel-dynamic',
  message: 'handler -> queueUrl',
  hint: 'queueUrl is looked up in queues by event.kind, a key worked out when the code runs. Send to an address the code states.',
  symbol: producer.id,
});

const linked = (functions: GraphNode[], producer: GraphNode = sender()) => {
  const handler: GraphNode = { id: 'relay#src/send.ts:handler', type: 'function', label: 'handler', repo: 'relay' };
  const nodes = new Map([...functions, handler, producer].map((node) => [node.id, structuredClone(node)]));
  const list: GraphEdge[] = [
    ...functions.map((each): GraphEdge => ({ from: each.id, to: handler.id, type: 'handles', confidence: 'static' })),
    { from: handler.id, to: producer.id, type: 'calls', confidence: 'heuristic' },
  ];
  const edges = new Map(list.map((each) => [edgeKey(each), each]));
  const rows = [row(producer)];
  const found = boundByGrants(nodes, edges, [rows]);
  return { nodes, edges: [...edges.values()], rows, found };
};

describe('boundByGrants', () => {
  it('draws a send whose address is not read to each queue its function is granted, as a guess, and says so in place of the row', () => {
    const { nodes, edges, rows, found } = linked([
      fn('dispatch', [
        { kind: 'queue', name: 'orders', by: 'SQSSendMessagePolicy' },
        { kind: 'queue', name: 'refunds', by: 'SQSSendMessagePolicy' },
        { kind: 'table', name: 'ledger', by: 'DynamoDBCrudPolicy' },
      ]),
    ]);
    const emits = edges.filter((each) => each.type === 'emits');
    expect(emits.map((each) => [each.to, each.confidence, each.meta?.['via'], each.params])).toEqual([
      ['channel:sqs/orders', 'heuristic', 'grant', ['type:relay#Order']],
      ['channel:sqs/refunds', 'heuristic', 'grant', ['type:relay#Order']],
    ]);
    expect(nodes.get('channel:sqs/orders')?.meta?.['channelKind']).toBe('queue');
    expect(rows).toEqual([]);
    expect(found.map((each) => each.reason)).toEqual(['channel-from-grant']);
    expect(found[0]?.message).toContain('queueUrl is looked up in queues by event.kind');
    expect(found[0]?.message).toContain('granted only sqs/orders, sqs/refunds');
  });

  it('draws nothing where a function is granted every queue, and says so on the row that stays', () => {
    const { edges, rows, found } = linked([fn('fanout', [{ kind: 'queue', any: 'arn:aws:sqs:*:*:*', by: 'iamRoleStatements[0]' }])]);
    expect(edges.filter((each) => each.type === 'emits')).toEqual([]);
    expect(found).toEqual([]);
    expect(rows.map((each) => each.reason)).toEqual(['channel-dynamic']);
    expect(rows[0]?.hint).toContain('fanout is granted every queue by iamRoleStatements[0] on arn:aws:sqs:*:*:*, which bounds nothing');
  });

  it('draws nothing where the function is granted nothing of the kind, or the send is placed already', () => {
    expect(linked([fn('dispatch', [{ kind: 'topic', name: 'shop', by: 'SNSPublishMessagePolicy' }])]).found).toEqual([]);
    const placed = linked([fn('dispatch', [{ kind: 'queue', name: 'orders', by: 'SQSSendMessagePolicy' }])], sender({ [REACHES_META]: ['invoke:place'] }));
    expect(placed.found).toEqual([]);
  });

  it('reaches each function a start is granted, by its deployed name', () => {
    const producer = sender({ adapter: 'aws-lambda-invoke', [STARTS_META]: 'invoke', [GRANTABLE_META]: [{ parts: [{ granted: 'function' }] }] });
    const { nodes, found } = linked([fn('route', [{ kind: 'function', name: 'place', by: 'LambdaInvokePolicy' }])], producer);
    expect(nodes.get(producer.id)?.meta?.[REACHES_META]).toEqual(['invoke:place']);
    expect(nodes.get(producer.id)?.meta?.['confidence']).toBe('heuristic');
    expect(found.map((each) => each.reason)).toEqual(['channel-from-grant']);
  });
});
