import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { GraphEdge, GraphNode, ProjectGraph } from '@flowatlas/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProject } from './build.js';

/**
 * What P24 promises about code that starts a workflow or invokes a function by
 * its deployed name, read off the two fixtures' own source by hand rather than
 * off a recording (R09).
 */

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXED = '2026-01-01T00:00:00.000Z';
const scratch = mkdtempSync(join(ROOT, 'fixtures', '.scratch-starters-'));

const build = async (name: string): Promise<ProjectGraph> => {
  const dir = join(scratch, name);
  cpSync(join(ROOT, 'fixtures', name), dir, { recursive: true, filter: (from) => !from.split(sep).includes('.flowatlas') });
  return (await buildProject({ config: join(dir, 'flowatlas.config.json'), builtAt: FIXED })).project;
};

let sdk: ProjectGraph;
let helper: ProjectGraph;

beforeAll(async () => {
  sdk = await build('start-workflow-sdk');
  helper = await build('start-workflow-helper');
}, 240_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

/** What a body starts: each producer it calls, and the entry that producer reaches, with how far the join is trusted. */
const startsFrom = (graph: ProjectGraph, body: string): [string, string | undefined, string | undefined][] =>
  graph.edges
    .filter((edge) => edge.type === 'calls' && edge.from === body)
    .map((edge) => graph.nodes.find((node) => node.id === edge.to))
    .filter((node): node is GraphNode => node?.type === 'producer')
    .map((producer) => {
      const join = graph.edges.find((edge: GraphEdge) => edge.type === 'calls' && edge.from === producer.id);
      return [producer.label, join?.to, join?.confidence];
    });

describe('the SDK, called directly', () => {
  it('starts the workflow a handler is handed in its environment, and invokes functions by name and by ARN', () => {
    expect(startsFrom(sdk, 'lending#src/handlers/create-loan.ts:handler')).toEqual([
      ['invoke lending-hold-copies', 'entry:lending:invoke:lending-hold-copies', 'static'],
      ['start lending-loan-approval', 'entry:lending:workflow:lending-loan-approval', 'static'],
      ['invoke-async lending-notify-borrower', 'entry:lending:invoke:lending-notify-borrower', 'static'],
    ]);
    // The row that said the name was a variable goes once the deployment answers it.
    expect(sdk.unresolved.filter((row) => row.reason === 'start-from-environment')).toEqual([]);
  });

  it('reads version 2, where Step Functions is a class of another name', () => {
    expect(startsFrom(sdk, 'lending#src/handlers/renew-loan.ts:handler')).toEqual([
      ['start lending-loan-approval', 'entry:lending:workflow:lending-loan-approval', 'static'],
    ]);
  });

  it('records an answer to a waiting task as a leaf, joined to nothing', () => {
    expect(startsFrom(sdk, 'lending#src/handlers/record-review.ts:handler')).toEqual([
      ['task-success', undefined, undefined],
      ['task-failure', undefined, undefined],
    ]);
  });

  it('draws no channel for any of it', () => {
    expect(sdk.nodes.filter((node) => node.type === 'channel')).toEqual([]);
  });
});

describe('a helper', () => {
  it('whose source is read is followed out to the caller, whose argument names the workflow', () => {
    const [read] = startsFrom(helper, 'lending#src/handlers/create-loan.ts:handler');
    expect(read).toEqual(['start lending-loan-approval', 'entry:lending:workflow:lending-loan-approval', 'static']);
    // Drawn where the name is decided, and not a second time inside the helper.
    expect(helper.nodes.filter((node) => node.type === 'producer' && node.file?.includes('packages/workflows'))).toEqual([]);
  });

  it('whose package is absent is read through its description, declared where a table names it', () => {
    expect(startsFrom(helper, 'lending#src/handlers/create-loan.ts:handler')[1]).toEqual([
      'start lending-reserve-copies',
      'entry:lending:workflow:lending-reserve-copies',
      'declared',
    ]);
    expect(startsFrom(helper, 'lending#src/handlers/renew-loan.ts:handler')).toEqual([
      ['start lending-loan-approval', 'entry:lending:workflow:lending-loan-approval', 'static'],
    ]);
  });

  it('that nothing describes is one row naming the package and the function, with the description to write', () => {
    const rows = helper.unresolved.filter((row) => row.reason === 'starter-undescribed');
    expect(rows.map((row) => [row.file, row.line, row.symbol])).toEqual([['src/handlers/renew-loan.ts', 13, '@library/scheduling schedule']]);
    expect(rows[0]?.meta?.['description']).toEqual({
      module: '@library/scheduling',
      function: 'schedule',
      target: 'workflow',
      name: [{ kind: 'argument', index: 0 }],
      names: { 'Reminder.LoanDue': '<deployed name>' },
    });
  });
});
