import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { GraphEdge, ProjectGraph } from '@flowatlas/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProject } from './build.js';

/**
 * What P23 promises about subscribers declared in Terraform, read off the three
 * fixtures' own source by hand rather than off a recording (R09).
 */

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXED = '2026-01-01T00:00:00.000Z';
const scratch = mkdtempSync(join(ROOT, 'fixtures', '.scratch-subscribers-'));

const build = async (name: string): Promise<ProjectGraph> => {
  const dir = join(scratch, name);
  cpSync(join(ROOT, 'fixtures', name), dir, { recursive: true, filter: (from) => !from.split(sep).includes('.flowatlas') });
  return (await buildProject({ config: join(dir, 'flowatlas.config.json'), builtAt: FIXED })).project;
};

let events: ProjectGraph;
let queues: ProjectGraph;
let multi: ProjectGraph;

beforeAll(async () => {
  events = await build('eventbridge-terraform');
  queues = await build('sqs-sns-terraform');
  multi = await build('multi-repo-events');
}, 240_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const edgesOf = (graph: ProjectGraph, type: GraphEdge['type'], at: string, side: 'from' | 'to' = 'from'): GraphEdge[] =>
  graph.edges.filter((edge) => edge.type === type && edge[side] === at);

const ch = (name: string): string => `channel:${name}`;

describe('a rule is the subscriber of the channels its pattern names', () => {
  it('meets the publisher on one node, static, where source and detail type are exact', () => {
    const loanCreated = ch('eventbridge/library/library.loans/LoanCreated');
    expect(edgesOf(events, 'emits', loanCreated, 'to').map((edge) => [edge.from, edge.confidence])).toEqual([
      ['producer:circulation#src/loans/create-loan.ts:11:9', 'static'],
    ]);
    expect(edgesOf(events, 'consumes', loanCreated).map((edge) => [edge.to, edge.confidence])).toEqual([
      ['consumer:circulation#infra/rules.tf:aws_cloudwatch_event_target.notify_on_loan', 'static'],
    ]);
    expect(edgesOf(events, 'calls', 'consumer:circulation#infra/rules.tf:aws_cloudwatch_event_target.notify_on_loan').map((edge) => edge.to)).toEqual([
      'entry:circulation:invoke:library-notify-borrower',
    ]);
  });

  it('matches a prefix as written, heuristic, and says why', () => {
    const [consumes] = edgesOf(events, 'consumes', ch('eventbridge/library/library.loans/LoanRenewed'));
    expect(consumes?.confidence).toBe('heuristic');
    expect(consumes?.meta).toEqual({ via: 'pattern', because: ['source "library.loans" matches prefix "library."'], notMatchedOn: ['detail'] });
    expect(edgesOf(events, 'calls', consumes?.to ?? '').map((edge) => edge.to)).toEqual(['entry:circulation:workflow:loan-review']);
  });

  it('is a way in with no producer, not a fault, for events nothing here puts', () => {
    const cover = ch('eventbridge/default/aws.s3/Object Created');
    expect(edgesOf(events, 'emits', cover, 'to')).toEqual([]);
    expect(edgesOf(events, 'consumes', cover)).toHaveLength(1);
    expect(events.unresolved.filter((row) => row.symbol?.includes('cover'))).toEqual([]);
  });

  it('draws a route integrated with PutEvents as the publisher of that event', () => {
    const [sends] = edgesOf(events, 'calls', 'entry:circulation:http:POST:/holds');
    expect(edgesOf(events, 'emits', sends?.to ?? '').map((edge) => edge.to)).toEqual([ch('eventbridge/library/library.holds/HoldRequested')]);
  });

  it('runs a schedule as a cron entry onto its target function', () => {
    expect(edgesOf(events, 'handles', 'entry:circulation:cron:library-nightly-overdue').map((edge) => edge.to)).toEqual([
      'circulation#src/overdue/scan-overdue.ts:handler',
    ]);
  });

  it('reads the described helper as a publisher on the channel a rule takes', () => {
    expect(edgesOf(events, 'emits', ch('eventbridge/library/library.returns/ItemReturned'), 'to').map((edge) => edge.from)).toEqual([
      'producer:circulation#src/returns/record-return.ts:13:9',
    ]);
  });
});

describe('a queue named by the environment, and what reads queues and topics', () => {
  const returns = ch('sqs/library-returns');

  it('completes the queue through the function that runs the call, and the row naming the variable goes', () => {
    expect(edgesOf(queues, 'emits', returns, 'to').map((edge) => [edge.from, edge.confidence, edge.meta?.['functions']])).toEqual([
      ['producer:returns#src/lib/returns-queue.ts:17:9', 'static', ['library-record-return']],
    ]);
    expect(queues.unresolved.filter((row) => row.reason === 'channel-from-environment' && row.file === 'src/lib/returns-queue.ts')).toEqual([]);
  });

  it('names the function and the variable where the function running it does not set it', () => {
    expect(queues.unresolved.filter((row) => row.reason === 'environment-not-set').map((row) => row.meta)).toEqual([
      { function: 'entry:returns:invoke:library-bulk-return', variable: 'RETURNS_QUEUE_URL' },
    ]);
  });

  it('names the variable files where they disagree on the value', () => {
    const [row] = queues.unresolved.filter((each) => each.reason === 'environment-value-unread');
    expect(Object.keys((row?.meta?.['files'] as Record<string, string> | undefined) ?? {})).toEqual(['infra/env/dev.tfvars', 'infra/env/prod.tfvars']);
  });

  it('reads the mapping as the queue\'s consumer, the topic\'s fan-out to a queue and a function, and the redrives', () => {
    expect(edgesOf(queues, 'consumes', returns).map((edge) => edge.to)).toEqual(['consumer:returns#infra/mappings.tf:aws_lambda_event_source_mapping.process_returns']);
    expect(edgesOf(queues, 'consumes', ch('sns/library-item-returned')).map((edge) => edge.to).sort()).toEqual([
      'consumer:returns#infra/topics.tf:aws_sns_topic_subscription.branch_inbox',
      'consumer:returns#infra/topics.tf:aws_sns_topic_subscription.notify_borrower',
      'consumer:returns#infra/topics.tf:aws_sns_topic_subscription.restock',
    ]);
    const [redrive] = edgesOf(queues, 'triggers', returns);
    expect(edgesOf(queues, 'emits', redrive?.to ?? '').map((edge) => edge.to)).toEqual([ch('sqs/library-returns-dlq')]);
  });

  it('leaves the dead-letter queues with no reader, which is what dead reports', () => {
    const unread = queues.nodes.filter((node) => node.type === 'channel' && node.meta?.['consumers'] === 0).map((node) => node.id);
    expect(unread).toEqual([ch('sqs/library-restock-dlq'), ch('sqs/library-returns-dlq')]);
  });

  it('records where each settings key a function sets comes from', () => {
    const [read] = queues.edges.filter((edge) => edge.type === 'reads_config' && edge.to === 'config_key:returns#RETURNS_QUEUE_URL');
    expect(read?.meta?.['setBy']).toEqual([{ function: 'library-record-return', written: 'aws_sqs_queue.returns.url', value: 'library-returns' }]);
  });
});

describe('a publisher, rules and consumers in three repositories, the bus in a fourth', () => {
  const created = ch('eventbridge/library/library.loans/LoanCreated');

  it('completes the bus from a lookup of another repository\'s bus, by name and by ARN', () => {
    expect(multi.edges.filter((edge) => edge.type === 'emits' && edge.meta?.['via'] === 'environment').map((edge) => edge.to).sort()).toEqual([
      created,
      ch('eventbridge/library/library.loans/LoanReturned'),
    ]);
  });

  it('joins the rule to the function another repository deploys, by its name', () => {
    const consumer = 'consumer:routing#rules.tf:aws_cloudwatch_event_target.welcome_borrower';
    expect(edgesOf(multi, 'consumes', created).map((edge) => [edge.to, edge.confidence])).toEqual([
      ['consumer:platform-events#main.tf:module.library_bus.aws_cloudwatch_event_target.this["audit-audit-queue"]', 'heuristic'],
      [consumer, 'static'],
    ]);
    expect(edgesOf(multi, 'calls', consumer).map((edge) => [edge.to, edge.confidence])).toEqual([
      ['entry:notifications:invoke:library-welcome-borrower', 'static'],
    ]);
  });

  it('says once that a pattern for a partner\'s events matches nothing published here', () => {
    expect(multi.unresolved.filter((row) => row.reason === 'subscription-matches-nothing').map((row) => row.service)).toEqual(['routing']);
  });
});
