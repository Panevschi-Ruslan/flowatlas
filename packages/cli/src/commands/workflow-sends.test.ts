import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { GraphEdge, ProjectGraph } from '@flowatlas/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProject } from './build.js';
import { runImpact } from './impact.js';

/**
 * What R169 promises about the seams P22 and P23 left between them, read off
 * `multi-repo-stepfunctions` by hand rather than off a recording (R09): a step
 * that sends is a producer its subscriber in another repository is joined to,
 * `impact` climbs a workflow without being told how far, and a definition the
 * evaluator alone can find is watched by the build.
 */

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXED = '2026-01-01T00:00:00.000Z';
const scratch = mkdtempSync(join(ROOT, 'fixtures', '.scratch-workflow-sends-'));

const copyOf = (as: string): string => {
  const dir = join(scratch, as);
  cpSync(join(ROOT, 'fixtures', 'multi-repo-stepfunctions'), dir, {
    recursive: true,
    filter: (from) => !from.split(sep).includes('.flowatlas'),
  });
  return dir;
};

let dir: string;
let graph: ProjectGraph;

beforeAll(async () => {
  dir = copyOf('multi-repo-stepfunctions');
  graph = (await buildProject({ config: join(dir, 'flowatlas.config.json'), builtAt: FIXED })).project;
}, 240_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const edgesOf = (type: GraphEdge['type'], at: string, side: 'from' | 'to' = 'from'): GraphEdge[] =>
  graph.edges.filter((edge) => edge.type === type && edge[side] === at);

const STEP = 'circulation#statemachine/checkout.asl.json:circulation-checkout';

describe('a step that sends', () => {
  it.each([
    ['RequestCopyPull', 'sqs/catalogue-copy-pulls', 'consumer:catalogue#infra/main.tf:aws_lambda_event_source_mapping.copy_pulls'],
    ['PublishCheckout', 'sns/circulation-checkouts', 'consumer:members#infra/main.tf:aws_sns_topic_subscription.record_checkout'],
    [
      'AnnounceCheckout',
      'eventbridge/library/library.circulation/LoanCheckedOut',
      'consumer:catalogue#infra/main.tf:aws_cloudwatch_event_target.update_availability',
    ],
  ])('%s is a producer onto %s, which a subscriber in another repository reads', (state, channel, consumer) => {
    const [call] = edgesOf('calls', `${STEP}/${state}`).filter((edge) => edge.to.startsWith('producer:'));
    expect(call?.confidence).toBe('static');
    expect(edgesOf('emits', call?.to ?? '').map((edge) => [edge.to, edge.confidence])).toEqual([[`channel:${channel}`, 'static']]);
    expect(edgesOf('consumes', `channel:${channel}`).map((edge) => [edge.to, edge.confidence])).toEqual([[consumer, 'static']]);
  });

  it('carries the message it is given, as written, on the edge onto the channel', () => {
    const [call] = edgesOf('calls', `${STEP}/RequestCopyPull`).filter((edge) => edge.to.startsWith('producer:'));
    expect(edgesOf('emits', call?.to ?? '')[0]?.meta).toEqual({
      payload: { MessageBody: { 'copyId.$': '$.copy.copyId', 'borrowerId.$': '$.borrowerId' } },
    });
  });

  it('leaves no row saying a send is not joined', () => {
    expect(graph.unresolved.map((row) => row.reason)).toEqual(['workflow-named-by-file']);
  });
});

describe('impact without --depth', () => {
  it('climbs the checkout workflow in circulation to the route in members that starts it', () => {
    let out = '';
    runImpact(
      'members#src/handlers/send-notice.ts:handler',
      { config: join(dir, 'flowatlas.config.json'), format: 'json', entriesOnly: true },
      { out: (text) => (out += text), err: () => undefined, tty: false },
    );
    expect((JSON.parse(out) as { entries: string[] }).entries).toContain('entry:members:http:POST:/checkouts');
  });
});

describe('the build cache', () => {
  it('reads a repository again when a definition it loads through a local changed', async () => {
    const copy = copyOf('multi-repo-stepfunctions-cached');
    const config = join(copy, 'flowatlas.config.json');
    await buildProject({ config, builtAt: FIXED });
    // Nothing changed, nothing is read: the cache is what is being tested.
    expect((await buildProject({ config, builtAt: FIXED })).plan['members']?.mode).toBe('skip');
    const definition = join(copy, 'members', 'statemachine', 'borrower-notices.json');
    writeFileSync(definition, readFileSync(definition, 'utf8').replaceAll('"SendNotice"', '"SendBorrowerNotice"'));
    const again = await buildProject({ config, builtAt: FIXED });
    expect(again.plan['members']?.mode).toBe('full');
    const states = again.project.nodes
      .filter((node) => node.id.startsWith('members#statemachine/borrower-notices.json:'))
      .map((node) => node.id);
    expect(states).toEqual(['members#statemachine/borrower-notices.json:members-borrower-notices/SendBorrowerNotice']);
  }, 120_000);
});
