import {
  AWAITING_META,
  ENVIRONMENT_META,
  REACHES_META,
  STARTS_META,
  type EnvironmentValue,
  type GraphEdge,
  type GraphNode,
  type Unresolved,
} from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { completeFromEnvironment } from './environment-link.js';
import { edgeKey } from './order.js';

const QUEUE_FORMS = ['^https?://[^/]+/[^/]+/([^/?#]+)/?$', '^arn:[^:]+:sqs:[^:]*:[^:]*:([^:]+)$'];

const fn = (name: string, environment: Record<string, EnvironmentValue>): GraphNode => ({
  id: `entry:returns:invoke:${name}`,
  type: 'entry',
  kind: 'invoke',
  label: name,
  repo: 'returns',
  meta: { name, [ENVIRONMENT_META]: environment },
});

const helper: GraphNode = { id: 'returns#src/lib/queue.ts:queueReturn', type: 'function', label: 'queueReturn', repo: 'returns' };

const producer: GraphNode = {
  id: 'producer:returns#src/lib/queue.ts:9:3',
  type: 'producer',
  label: 'message ?',
  repo: 'returns',
  file: 'src/lib/queue.ts',
  line: 9,
  kind: 'message',
  meta: {
    kind: 'message',
    adapter: 'aws-sqs',
    channelKind: 'queue',
    confidence: 'static',
    [AWAITING_META]: [{ parts: ['sqs', { environment: 'RETURNS_QUEUE_URL', forms: QUEUE_FORMS }], payload: 'type:returns#ReturnedItem' }],
  },
};

const edge = (from: string, to: string, type: GraphEdge['type'], confidence: GraphEdge['confidence'] = 'static'): GraphEdge => ({ from, to, type, confidence });

/** Two functions running the one helper, and the row the extractor left at the call. */
const graph = (functions: GraphNode[]) => {
  const handlers = functions.map((each): GraphNode => ({ id: `returns#src/${each.label}.ts:handler`, type: 'function', label: 'handler', repo: 'returns' }));
  const nodes = new Map([...functions, ...handlers, helper, producer, { id: 'config_key:returns#RETURNS_QUEUE_URL', type: 'config_key', label: 'RETURNS_QUEUE_URL', repo: 'returns', meta: { key: 'RETURNS_QUEUE_URL' } } as GraphNode].map((node) => [node.id, structuredClone(node)]));
  const list = [
    ...functions.flatMap((each, index) => [
      edge(each.id, (handlers[index] as GraphNode).id, 'handles'),
      edge((handlers[index] as GraphNode).id, helper.id, 'calls'),
    ]),
    edge(helper.id, producer.id, 'calls', 'heuristic'),
    edge(helper.id, 'config_key:returns#RETURNS_QUEUE_URL', 'reads_config'),
  ];
  const edges = new Map(list.map((each) => [edgeKey(each), each]));
  const rows: Unresolved[] = [{ service: 'returns', file: 'src/lib/queue.ts', line: 9, reason: 'channel-from-environment', meta: { variable: 'RETURNS_QUEUE_URL' } }];
  const found = completeFromEnvironment(nodes, edges, rows);
  return { nodes, edges: [...edges.values()], rows, found };
};

describe('completeFromEnvironment', () => {
  it('completes an address from the value each function that runs it is deployed with', () => {
    const { nodes, edges, rows, found } = graph([
      fn('library-record-return', { RETURNS_QUEUE_URL: { written: 'aws_sqs_queue.returns.url', value: 'library-returns', kind: 'queue' } }),
    ]);
    expect(found).toEqual([]);
    // The extractor's row said nothing was known; a function runs the call, so it goes.
    expect(rows).toEqual([]);
    expect(edges.find((each) => each.type === 'emits')).toEqual({
      from: producer.id,
      to: 'channel:sqs/library-returns',
      type: 'emits',
      confidence: 'static',
      file: 'src/lib/queue.ts',
      line: 9,
      params: ['type:returns#ReturnedItem'],
      meta: { via: 'environment', variables: ['RETURNS_QUEUE_URL'], functions: ['library-record-return'] },
    });
    expect(nodes.get('channel:sqs/library-returns')?.meta).toEqual({ channelKind: 'queue', adapters: ['aws-sqs'] });
    expect(nodes.get(producer.id)?.label).toBe('message sqs/library-returns');
    // Drawn weak only because there was no channel to put it on; it is not weak now.
    expect(edges.find((each) => each.to === producer.id)?.confidence).toBe('static');
    expect(edges.find((each) => each.type === 'reads_config')?.meta).toEqual({
      setBy: [{ function: 'library-record-return', written: 'aws_sqs_queue.returns.url', value: 'library-returns' }],
    });
  });

  it('reads a URL written out through the forms the address carries', () => {
    const { edges } = graph([
      fn('library-record-return', { RETURNS_QUEUE_URL: { written: '"https://…"', value: 'https://sqs.eu-west-1.amazonaws.com/111122223333/library-returns' } }),
    ]);
    expect(edges.find((each) => each.type === 'emits')?.to).toBe('channel:sqs/library-returns');
  });

  it('sends to one queue per function where two functions set the variable differently', () => {
    const { edges } = graph([
      fn('library-record-return', { RETURNS_QUEUE_URL: { written: 'a', value: 'library-returns', kind: 'queue' } }),
      fn('library-late-return', { RETURNS_QUEUE_URL: { written: 'b', value: 'library-late-returns', kind: 'queue' } }),
    ]);
    expect(edges.filter((each) => each.type === 'emits').map((each) => [each.to, each.meta?.['functions']])).toEqual([
      ['channel:sqs/library-late-returns', ['library-late-return']],
      ['channel:sqs/library-returns', ['library-record-return']],
    ]);
  });

  it('names the function and the variable where the function does not set it', () => {
    const { edges, rows, found } = graph([
      fn('library-record-return', { RETURNS_QUEUE_URL: { written: 'a', value: 'library-returns', kind: 'queue' } }),
      fn('library-bulk-return', { BATCH_SIZE: { written: '"25"', value: '25' } }),
    ]);
    expect(edges.filter((each) => each.type === 'emits')).toHaveLength(1);
    expect(rows).toEqual([]);
    expect(found).toEqual([
      expect.objectContaining({
        reason: 'environment-not-set',
        file: 'src/lib/queue.ts',
        line: 9,
        meta: { function: 'entry:returns:invoke:library-bulk-return', variable: 'RETURNS_QUEUE_URL' },
      }),
    ]);
  });

  it('names the files where the value is disputed, and draws no channel', () => {
    const { edges, found } = graph([
      fn('library-record-return', {
        RETURNS_QUEUE_URL: { written: 'var.queue', unread: 'it differs', variable: 'queue', files: { 'dev.tfvars': '"a"', 'prod.tfvars': '"b"' } },
      }),
    ]);
    expect(edges.filter((each) => each.type === 'emits')).toEqual([]);
    expect(found).toEqual([
      expect.objectContaining({
        reason: 'environment-value-unread',
        hint: expect.stringContaining('services[].infra.vars'),
        meta: { function: 'entry:returns:invoke:library-record-return', variable: 'RETURNS_QUEUE_URL', files: { 'dev.tfvars': '"a"', 'prod.tfvars': '"b"' } },
      }),
    ]);
  });

  it('leaves an address nothing deployed runs exactly as it was, row and all', () => {
    const nodes = new Map([[producer.id, structuredClone(producer)], ...[fn('other', {})].map((node) => [node.id, node] as const)]);
    const edges = new Map<string, GraphEdge>();
    const rows: Unresolved[] = [{ service: 'returns', file: 'src/lib/queue.ts', line: 9, reason: 'channel-from-environment' }];
    expect(completeFromEnvironment(nodes, edges, rows)).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(edges.size).toBe(0);
  });

  it('completes what a start waits on into a reference to the entry it names, and no channel', () => {
    const starter: GraphNode = {
      id: 'producer:loans#src/create-loan.ts:12:9',
      type: 'producer',
      label: 'start ?',
      repo: 'loans',
      file: 'src/create-loan.ts',
      line: 12,
      kind: 'start',
      meta: { kind: 'start', [STARTS_META]: 'workflow', confidence: 'static', [AWAITING_META]: [{ parts: [{ environment: 'LOAN_APPROVAL_ARN' }] }] },
    };
    const deployed: GraphNode = {
      ...fn('lending-create-loan', { LOAN_APPROVAL_ARN: { written: 'aws_sfn_state_machine.loan_approval.arn', value: 'lending-loan-approval', kind: 'workflow' } }),
      repo: 'loans',
    };
    const handler: GraphNode = { id: 'loans#src/create-loan.ts:handler', type: 'function', label: 'handler', repo: 'loans' };
    const nodes = new Map([deployed, handler, starter].map((node) => [node.id, structuredClone(node)]));
    const edges = new Map(
      [edge(deployed.id, handler.id, 'handles'), edge(handler.id, starter.id, 'calls', 'heuristic')].map((each) => [edgeKey(each), each]),
    );
    const rows: Unresolved[] = [{ service: 'loans', file: 'src/create-loan.ts', line: 12, reason: 'start-from-environment' }];
    expect(completeFromEnvironment(nodes, edges, rows)).toEqual([]);
    expect(rows).toEqual([]);
    expect(nodes.get(starter.id)?.meta?.[REACHES_META]).toEqual(['workflow:lending-loan-approval']);
    expect(nodes.get(starter.id)?.label).toBe('start lending-loan-approval');
    expect([...nodes.values()].filter((node) => node.type === 'channel')).toEqual([]);
    expect([...edges.values()].find((each) => each.to === starter.id)?.confidence).toBe('static');
  });
});
