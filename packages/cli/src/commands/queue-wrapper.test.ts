import { join, resolve } from 'node:path';
import type { RepoGraph } from '@flowatlas/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { runExtract } from './extract.js';

/**
 * A service that runs its queues through a layer of its own over the broker:
 * its own worker decorators, read on `fixtures/nest-queue-wrapper`.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');

let graph: RepoGraph;

beforeAll(async () => {
  graph = (await runExtract(join(ROOT, 'fixtures', 'nest-queue-wrapper'), { out: '.flowatlas' })).graph;
}, 120_000);

const channels = (): string[] => graph.nodes.filter((node) => node.type === 'channel').map((node) => node.label).sort();

/** The channels a class's handler is consumed from. */
const consumedBy = (label: string): string[] => {
  const consumer = graph.nodes.find((node) => node.type === 'consumer' && node.label === label);
  if (consumer === undefined) return [];
  return graph.edges
    .filter((edge) => edge.type === 'consumes' && edge.to === consumer.id)
    .map((edge) => graph.nodes.find((node) => node.id === edge.from)?.label ?? edge.from)
    .sort();
};

describe('worker decorators of the repository’s own (R181)', () => {
  it('reads the queue an options object names, on the channel its word form lands on', () => {
    expect(consumedBy('CleanupCronJob.handle')).toEqual(['cron-queue']);
    expect(consumedBy('ReportCronJob.handle')).toEqual(['cron-queue']);
    expect(consumedBy('BuildExportJob.handle')).toEqual(['exports-queue']);
  });

  it('never draws a queue named by a record', () => {
    expect(channels().filter((name) => name.startsWith('{'))).toEqual([]);
    expect(consumedBy('AuditJob.handle')).toEqual([]);
    const row = graph.unresolved.find((each) => each.symbol?.startsWith('AuditJob.handle') === true);
    expect(row?.reason).toBe('channel-dynamic');
  });
});
