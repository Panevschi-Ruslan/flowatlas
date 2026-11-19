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

/** Every producer, as `file:line channel job`. */
const producers = (): string[] =>
  graph.nodes
    .filter((node) => node.type === 'producer')
    .map((node) => {
      const emits = graph.edges.filter((edge) => edge.type === 'emits' && edge.from === node.id);
      const channel = emits.map((edge) => graph.nodes.find((each) => each.id === edge.to)?.label).join(',') || '-';
      return `${node.file}:${node.line} ${channel} ${String(node.meta?.['jobName'])}`;
    })
    .sort();

describe('enqueues through the repository’s own queue service (P267)', () => {
  it('draws each enqueue where its caller names the queue and the job', () => {
    expect(producers()).toEqual([
      'src/cleanup/audit.service.ts:15 - audit',
      'src/cleanup/cleanup.scheduler.ts:14 cron-queue CleanupCronJob',
      'src/exports/exports.controller.ts:15 exports-queue BuildExportJob',
      'src/mail/welcome.service.ts:17 mail-queue SendMailJob',
      'src/mail/welcome.service.ts:22 mail-queue null',
      'src/mail/welcome.service.ts:26 mail-queue SendMailJob',
    ]);
  });

  it('reads the job a handler takes by its class’s name, so both ends name one job', () => {
    const jobs = graph.nodes.filter((node) => node.type === 'consumer').map((node) => node.meta?.['jobName']).sort();
    expect(jobs).toEqual(['BuildExportJob', 'CleanupCronJob', 'ReportCronJob', 'SendMailJob', 'audit']);
  });

  it('says which functions of its own the enqueue was handed through', () => {
    const scheduled = graph.nodes.find((node) => node.type === 'producer' && node.file === 'src/cleanup/cleanup.scheduler.ts');
    expect(scheduled?.meta?.['through']).toEqual(['BullMqDriver.addCron', 'JobQueueService.addCron']);
    expect(scheduled?.meta?.['method']).toBe('upsertJobScheduler');
  });

  it('carries the message the caller hands in', () => {
    const start = graph.nodes.find((node) => node.type === 'producer' && node.file === 'src/exports/exports.controller.ts');
    const emits = graph.edges.find((edge) => edge.type === 'emits' && edge.from === start?.id);
    expect(emits?.params).toEqual(["{exportId:string;format:'csv'}"]);
  });

  it('names the instance it could not read, where the enqueue is', () => {
    const row = graph.unresolved.find((each) => each.file === 'src/cleanup/audit.service.ts' && each.reason === 'channel-dynamic');
    expect(row?.hint).toContain('this.auditQueue is an instance of JobQueueService');
  });

  it('draws nothing in the driver every enqueue is handed down to', () => {
    expect(producers().filter((each) => each.includes('bullmq.driver'))).toEqual([]);
  });
});
