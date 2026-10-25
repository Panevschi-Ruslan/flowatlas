import {
  GraphBuilder,
  makeEntryId,
  noAdapters,
  parseConfig,
  silentLogger,
  type DeployedDelivery,
  type Deployment,
  type EntryNode,
  type ExtractContext,
  type GraphEdge,
  type GraphNode,
  type Unresolved,
} from '@flowatlas/core';
import { Project } from 'ts-morph';
import { describe, expect, it } from 'vitest';
import { drawDeliveries } from './deployed-channels.js';

/**
 * The drawing of a deployment's deliveries, read without a deployment file.
 *
 * The fixtures cover these through a whole reading; here each rule is one
 * delivery or two, so a change to one rule fails one test. The deployment
 * creates one function, `lending-loans`, whose `invoke` entry is handed in the
 * way the extractor hands it in; every entry returned is added as a node, as
 * the extractor would, so the graph builds.
 */

const FILE = 'infra/main.tf';
const LOANS = makeEntryId('library', 'invoke', 'lending-loans');
const IOT = makeEntryId('library', 'event', 'iot/library/returns');
const FAILURE = { when: 'failure' };

interface Drawn {
  readonly entries: readonly EntryNode[];
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly rows: readonly Unresolved[];
}

const draw = (...deliveries: DeployedDelivery[]): Drawn => {
  const project = new Project({ useInMemoryFileSystem: true });
  const ctx: ExtractContext = {
    repo: 'library',
    repoDir: '/',
    service: { name: 'library', repo: '/', type: 'express' },
    config: parseConfig({}),
    pkg: {},
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'library' }),
    adapters: noAdapters,
    logger: silentLogger,
  };
  const deployment: Deployment = {
    functions: [{ file: FILE, line: 1, name: 'lending-loans', address: 'aws_lambda_function.loans' }],
    routes: [],
    roots: [],
    workflows: [],
    deliveries,
    rows: [],
  };
  const invoke: EntryNode = { id: LOANS, kind: 'invoke', label: 'invoke lending-loans', key: 'lending-loans', file: FILE, line: 1, meta: {} };
  const rows: Unresolved[] = [];
  const returned = drawDeliveries(ctx, deployment, 'terraform', rows, new Map(), () => undefined, (id) => (id === LOANS ? invoke : undefined));
  const entries = [invoke, ...returned];
  for (const entry of entries) {
    ctx.builder.addNode({ id: entry.id, type: 'entry', label: entry.label, repo: ctx.repo, file: entry.file, line: entry.line, meta: entry.meta ?? {} });
  }
  const graph = ctx.builder.build();
  return { entries, nodes: graph.nodes, edges: graph.edges, rows };
};

const delivery = (
  address: string,
  by: DeployedDelivery['by'],
  from: DeployedDelivery['from'],
  to?: DeployedDelivery['to'],
  meta?: Record<string, unknown>,
): DeployedDelivery => ({
  file: FILE,
  line: 10,
  address,
  by,
  from,
  ...(to === undefined ? {} : { to }),
  ...(meta === undefined ? {} : { meta }),
});

const iot = (address: string, to: DeployedDelivery['to'], meta?: Record<string, unknown>): DeployedDelivery =>
  delivery(address, 'trigger', { kind: 'trigger', service: 'iot', key: 'iot/library/returns' }, to, meta);

const nodeOf = (drawn: Drawn, id: string): GraphNode | undefined => drawn.nodes.find((node) => node.id === id);
const entryOf = (drawn: Drawn, id: string): EntryNode | undefined => drawn.entries.find((entry) => entry.id === id);
const edgesFrom = (drawn: Drawn, from: string): GraphEdge[] => drawn.edges.filter((edge) => edge.from === from);
const consumer = (address: string): string => `consumer:library#${FILE}:${address}`;
const producer = (address: string): string => `producer:library#${FILE}:${address}`;

describe('what a function run ends in (P54, P60)', () => {
  it('hands a local function on from its own entry, onto a queue, with the outcome on the edge', () => {
    const drawn = draw(
      delivery('dest.done', 'destination', { kind: 'outcome', when: 'success', of: { function: 0 } }, { kind: 'queue', name: 'loans-done' }),
    );
    expect(edgesFrom(drawn, LOANS)).toEqual([
      expect.objectContaining({ to: producer('dest.done'), type: 'triggers', meta: { via: 'deployment', when: 'success' } }),
    ]);
    expect(edgesFrom(drawn, producer('dest.done'))).toEqual([expect.objectContaining({ to: 'channel:sqs/loans-done', type: 'emits' })]);
  });

  it('hands on to a topic and a bus by a publisher each, with the outcome', () => {
    const drawn = draw(
      delivery('dest.topic', 'destination', { kind: 'outcome', when: 'failure', of: { function: 0 } }, { kind: 'topic', name: 'loans-failed' }),
      delivery(
        'dest.bus',
        'destination',
        { kind: 'outcome', when: 'success', of: { function: 0 } },
        { kind: 'bus', name: 'library', fields: { source: 'lending', 'detail-type': 'LoanDone' } },
      ),
    );
    const out = edgesFrom(drawn, LOANS);
    expect(out).toContainEqual(expect.objectContaining({ to: producer('dest.topic'), type: 'triggers', meta: { via: 'deployment', when: 'failure' } }));
    expect(out).toContainEqual(expect.objectContaining({ to: producer('dest.bus'), type: 'triggers', meta: { via: 'deployment', when: 'success' } }));
    expect(edgesFrom(drawn, producer('dest.topic'))).toEqual([expect.objectContaining({ to: 'channel:sns/loans-failed' })]);
  });

  it('hands a batch a mapping gave up on from the consumer the mapping drew', () => {
    const drawn = draw(
      delivery('mapping.holds', 'mapping', { kind: 'queue', name: 'holds' }, { kind: 'function', function: 0 }),
      delivery('mapping.holds:on_failure', 'destination', { kind: 'outcome', when: 'failure', of: { delivery: 'mapping.holds' } }, { kind: 'queue', name: 'holds-failed' }),
    );
    expect(edgesFrom(drawn, consumer('mapping.holds'))).toEqual([
      expect.objectContaining({ to: LOANS, type: 'calls', meta: { via: 'deployment' } }),
      expect.objectContaining({ to: producer('mapping.holds:on_failure'), type: 'triggers', meta: { via: 'deployment', when: 'failure' } }),
    ]);
  });

  it('records a function reached by name as a triggers reference with its outcome', () => {
    const drawn = draw(
      delivery('mapping.holds', 'mapping', { kind: 'queue', name: 'holds' }, { kind: 'function', function: 0 }),
      delivery('dest.alarm', 'destination', { kind: 'outcome', when: 'failure', of: { delivery: 'mapping.holds' } }, { kind: 'function', name: 'lending-alarm' }),
    );
    expect(nodeOf(drawn, consumer('mapping.holds'))?.meta).toMatchObject({
      reaches: ['invoke:lending-alarm'],
      reachedAs: { 'invoke:lending-alarm': { type: 'triggers', when: 'failure' } },
    });
  });

  it('draws a function another deployment creates as a result consumer the linker joins to its entry', () => {
    const drawn = draw(
      delivery('dest.remote', 'destination', { kind: 'outcome', when: 'failure', of: { name: 'members-sync' } }, { kind: 'workflow', name: 'members-repair' }),
    );
    expect(nodeOf(drawn, consumer('dest.remote'))).toMatchObject({
      type: 'consumer',
      kind: 'result',
      meta: {
        adapter: 'aws-lambda',
        resultOf: 'invoke:members-sync',
        reaches: ['workflow:members-repair'],
        reachedAs: { 'workflow:members-repair': { type: 'triggers', when: 'failure' } },
      },
    });
  });

  it('draws a result consumer that joins nothing where the mapping it names was not drawn', () => {
    const drawn = draw(delivery('dest.lost', 'destination', { kind: 'outcome', when: 'failure', of: { delivery: 'nowhere' } }, { kind: 'queue', name: 'lost' }));
    expect(nodeOf(drawn, consumer('dest.lost'))?.meta?.['resultOf']).toBeUndefined();
    expect(edgesFrom(drawn, consumer('dest.lost'))).toEqual([
      expect.objectContaining({ type: 'triggers', meta: { via: 'deployment', when: 'failure' } }),
    ]);
  });

  it("prefers a destination's outcome over a delivery's own", () => {
    const drawn = draw(
      delivery('dest.ok', 'destination', { kind: 'outcome', when: 'success', of: { function: 0 } }, { kind: 'workflow', name: 'loans-report' }, FAILURE),
    );
    expect(entryOf(drawn, LOANS)?.meta?.['reachedAs']).toEqual({ 'workflow:loans-report': { type: 'triggers', when: 'success' } });
  });
});

describe("an IoT rule's error action (P56, P60)", () => {
  it('keeps the outcome off the entry the actions share, and puts it on what the error action draws', () => {
    const drawn = draw(iot('rule.returns:0', { kind: 'function', function: 0 }), iot('rule.returns:error', { kind: 'queue', name: 'returns-errors' }, FAILURE));
    expect(entryOf(drawn, IOT)?.meta?.['when']).toBeUndefined();
    expect(edgesFrom(drawn, IOT)).toEqual([
      expect.objectContaining({ to: LOANS, type: 'calls', meta: { via: 'deployment' } }),
      expect.objectContaining({ to: producer('rule.returns:error'), type: 'calls', meta: { via: 'deployment', when: 'failure' } }),
    ]);
    expect(nodeOf(drawn, producer('rule.returns:error'))?.meta?.['when']).toBe('failure');
  });

  it('carries the outcome of a function the error action reaches by name, and never runs it as the entry', () => {
    const drawn = draw(
      iot('rule.returns:0', { kind: 'changes', of: 'table', name: 'returns' }),
      iot('rule.returns:error', { kind: 'function', name: 'returns-alarm' }, FAILURE),
    );
    const entry = entryOf(drawn, IOT);
    expect(entry?.meta?.['invokes']).toBeUndefined();
    expect(entry?.meta).toMatchObject({ reaches: ['invoke:returns-alarm'], reachedAs: { 'invoke:returns-alarm': { when: 'failure' } } });
  });

  it('runs a function an action names as the entry, and the error action as a reference beside it', () => {
    const drawn = draw(
      iot('rule.returns:error', { kind: 'function', name: 'returns-alarm' }, FAILURE),
      iot('rule.returns:0', { kind: 'function', name: 'returns-intake' }),
    );
    expect(entryOf(drawn, IOT)?.meta).toMatchObject({ invokes: 'returns-intake', reachedAs: { 'invoke:returns-alarm': { when: 'failure' } } });
  });

  it('records a workflow reached only by the error action with its outcome', () => {
    const drawn = draw(iot('rule.returns:error', { kind: 'workflow', name: 'returns-repair' }, FAILURE));
    expect(entryOf(drawn, IOT)?.meta?.['reachedAs']).toEqual({ 'workflow:returns-repair': { when: 'failure' } });
  });

  it('leaves a target reached both by an action and by the error action plain, in either order', () => {
    const target = { kind: 'workflow', name: 'returns-repair' } as const;
    for (const order of [
      [iot('rule.returns:0', target), iot('rule.returns:error', target, FAILURE)],
      [iot('rule.returns:error', target, FAILURE), iot('rule.returns:0', target)],
    ]) {
      const entry = entryOf(draw(...order), IOT);
      expect(entry?.meta?.['reaches']).toEqual(['workflow:returns-repair']);
      expect(entry?.meta?.['reachedAs']).toBeUndefined();
    }
  });
});

describe('a write the service makes itself (P56)', () => {
  it('marks a table write as a channel only where its stream is declared', () => {
    const drawn = draw(iot('rule.returns:0', { kind: 'changes', of: 'table', name: 'returns' }));
    expect(nodeOf(drawn, producer('rule.returns:0'))?.meta).toMatchObject({ adapter: 'aws-dynamodb', whereDeclared: true });
    expect(edgesFrom(drawn, producer('rule.returns:0'))).toEqual([expect.objectContaining({ to: 'channel:dynamodb/returns', type: 'emits' })]);
    expect(nodeOf(drawn, 'channel:dynamodb/returns')?.meta?.['declaredBy']).toBeUndefined();
  });

  it('puts records on a stream as a channel always', () => {
    const drawn = draw(iot('rule.returns:0', { kind: 'changes', of: 'stream', name: 'returns-feed' }));
    expect(nodeOf(drawn, producer('rule.returns:0'))?.meta?.['whereDeclared']).toBeUndefined();
    expect(edgesFrom(drawn, producer('rule.returns:0'))).toEqual([expect.objectContaining({ to: 'channel:kinesis/returns-feed' })]);
  });
});

describe('a bucket notification and a service trigger (P52, P56)', () => {
  it('says which writes a notification takes, and a delete on a versioned bucket as the marker it leaves', () => {
    const drawn = draw(
      delivery(
        'notification.scans',
        'notification',
        { kind: 'bucket', name: 'library-scans', events: ['s3:ObjectCreated:*'], prefix: 'in/', suffix: '.pdf', versioned: true },
        { kind: 'function', function: 0 },
      ),
    );
    const id = consumer('notification.scans');
    expect(nodeOf(drawn, id)).toMatchObject({
      kind: 'object',
      meta: { adapter: 'aws-s3', takes: { kinds: ['s3:ObjectCreated:*'], by: { field: 'Key', prefix: 'in/', suffix: '.pdf' } } },
    });
    expect((nodeOf(drawn, id)?.meta?.['takes'] as { instead?: unknown[] }).instead).toHaveLength(1);
    expect(drawn.edges).toContainEqual(expect.objectContaining({ from: 'channel:s3/library-scans', to: id, type: 'consumes' }));
  });

  it('takes no versioned delete and filters no key where the notification says neither', () => {
    const drawn = draw(delivery('notification.removed', 'notification', { kind: 'bucket', name: 'library-scans', events: ['s3:ObjectRemoved:*'] }, { kind: 'function', function: 0 }));
    expect(nodeOf(drawn, consumer('notification.removed'))?.meta?.['takes']).toEqual({ kinds: ['s3:ObjectRemoved:*'] });
  });

  it("draws a trigger as an entry of the service's own, keeping a delivery's outcome off it", () => {
    const drawn = draw(
      delivery('pool.signup', 'trigger', { kind: 'trigger', service: 'cognito', key: 'cognito/members/PreSignUp' }, { kind: 'function', function: 0 }, { when: 'failure', stage: 'pre' }),
    );
    const entry = entryOf(drawn, makeEntryId('library', 'event', 'cognito/members/PreSignUp'));
    expect(entry?.meta).toMatchObject({ service: 'cognito', stage: 'pre' });
    expect(entry?.meta?.['when']).toBeUndefined();
  });
});
