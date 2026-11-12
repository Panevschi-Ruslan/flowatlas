import { join, resolve } from 'node:path';
import type { RepoGraph } from '@flowatlas/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { runExtract } from './extract.js';

/**
 * Workers made by a construction, read on `fixtures/express-job-workers`
 * (P271).
 */
const ROOT = resolve(import.meta.dirname, '../../../..');

let graph: RepoGraph;

beforeAll(async () => {
  graph = (await runExtract(join(ROOT, 'fixtures', 'express-job-workers'), { out: '.flowatlas' })).graph;
}, 120_000);

const labelOf = (id: string): string => graph.nodes.find((node) => node.id === id)?.label ?? id;

/** Every consumer as `handler: queue, queue`. */
const consumers = (): string[] =>
  graph.nodes
    .filter((node) => node.type === 'consumer')
    .map((node) => {
      const queues = graph.edges.filter((edge) => edge.type === 'consumes' && edge.to === node.id).map((edge) => labelOf(edge.from));
      return `${node.label}: ${queues.sort().join(', ')}`;
    })
    .sort();

describe('workers made by a construction (P271)', () => {
  it('reads one queue per key of the record a loop walks, its handler the member the processor looks up', () => {
    expect(consumers()).toEqual([
      'ReportsQueue.build: reports-queue',
      'auditWorker@5: audit-queue',
      'makeThumbnail: make-thumbnail',
      'refreshCatalog: refresh-catalog',
      'sendReceipt: ',
      'sendReceipt: mail-high, mail-low',
      'sendReceipt: send-receipt',
    ]);
  });

  it('says where the walk out stopped, and the function the name was handed out of', () => {
    const looped = graph.nodes.find((node) => node.type === 'consumer' && node.label === 'makeThumbnail');
    expect(looped?.meta?.['through']).toEqual(['JobQueue.buildWorker']);
    const row = graph.unresolved.find((each) => each.reason === 'channel-dynamic' && each.file === 'src/jobs/side-workers.ts');
    expect(row?.hint).toContain('queuesFromSettings is not a list written out');
  });

  it('joins each enqueue to the worker of its queue, and names the job the older library’s worker takes', () => {
    const both = graph.nodes
      .filter((node) => node.type === 'channel')
      .filter((channel) => graph.edges.some((edge) => edge.type === 'emits' && edge.to === channel.id))
      .filter((channel) => graph.edges.some((edge) => edge.type === 'consumes' && edge.from === channel.id))
      .map((channel) => channel.label)
      .sort();
    expect(both).toEqual(['make-thumbnail', 'reports-queue', 'send-receipt']);
    const legacy = graph.nodes.find((node) => node.type === 'consumer' && node.label === 'ReportsQueue.build');
    expect(legacy?.meta?.['jobName']).toBe('build-report');
  });
});
