import type { GraphEdge, GraphNode } from '@flowatlas/core';
import { describe, expect, it } from 'vitest';
import { jobsWithoutHandler } from './job-link.js';
import { edgeKey } from './order.js';

const CHANNEL: GraphNode = { id: 'channel:mail-queue', type: 'channel', label: 'mail-queue', repo: 'mailer' };

const handler = (id: string, jobName?: string): GraphNode => ({
  id,
  type: 'consumer',
  label: id,
  repo: 'mailer',
  meta: { kind: 'job', ...(jobName === undefined ? {} : { jobName }) },
});

const producer = (id: string, meta: Record<string, unknown>): GraphNode => ({
  id,
  type: 'producer',
  label: 'job mail-queue',
  repo: 'shop',
  file: 'src/orders.ts',
  line: 7,
  meta: { kind: 'job', ...meta },
});

const run = (handlers: GraphNode[], producers: GraphNode[]) => {
  const nodes = new Map([CHANNEL, ...handlers, ...producers].map((node) => [node.id, node]));
  const edges = new Map<string, GraphEdge>();
  const add = (edge: GraphEdge): void => void edges.set(edgeKey(edge), edge);
  for (const each of handlers) add({ from: CHANNEL.id, to: each.id, type: 'consumes', confidence: 'static' });
  for (const each of producers) add({ from: each.id, to: CHANNEL.id, type: 'emits', confidence: 'static' });
  return jobsWithoutHandler(nodes, edges);
};

describe('jobsWithoutHandler (P271)', () => {
  it('says a job no handler of its queue takes, where every handler names its job', () => {
    const rows = run(
      [handler('welcome', 'send-welcome'), handler('receipt', 'send-receipt')],
      [producer('ok', { jobName: 'send-welcome' }), producer('lost', { jobName: 'send-invoice' })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      reason: 'job-no-handler',
      level: 'info',
      service: 'shop',
      symbol: 'lost',
      meta: { job: 'send-invoice', queue: 'mail-queue', handled: ['send-receipt', 'send-welcome'] },
    });
  });

  it('reads each job of a call whose entries name several', () => {
    const rows = run([handler('welcome', 'send-welcome')], [producer('pair', { jobName: null, jobNames: ['send-digest', 'send-welcome'] })]);
    expect(rows.map((row) => row.meta?.['job'])).toEqual(['send-digest']);
  });

  it('stays quiet where a handler takes every job, or the job is not read', () => {
    expect(run([handler('welcome', 'send-welcome'), handler('any')], [producer('lost', { jobName: 'send-invoice' })])).toEqual([]);
    expect(run([handler('welcome', 'send-welcome')], [producer('unread', { jobName: null })])).toEqual([]);
  });
});
