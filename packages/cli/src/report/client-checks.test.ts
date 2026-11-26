import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SpecChange, SpecDiffReport } from '@flowatlas/linker';
import { readDiff, summariseChanges } from '@flowatlas/mcp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDiff } from '../commands/diff.js';
import { runSpecDiff } from '../commands/spec.js';

/**
 * What clients already check, weighed in the verdicts (P402), over
 * `fixtures/client-checks-verdicts`: a query key and a header made required,
 * a status and a message kind widened, judged by what the dashboard sends and
 * how each switch meets the new value; and `what_changed` saying the same.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURES = join(ROOT, 'fixtures');
const FIXTURE = join(FIXTURES, 'client-checks-verdicts');
const FIXED = '2026-01-01T00:00:00.000Z';

const scratch = mkdtempSync(join(FIXTURES, '.scratch-client-checks-'));
const project = join(scratch, 'project');
const config = join(project, 'flowatlas.config.json');
const quiet = { out(): void {}, err(): void {}, tty: false };
const git = (repo: string, ...args: string[]): void => {
  execFileSync('git', ['-C', join(project, repo), '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args]);
};

let report: SpecDiffReport;
const change = (operation: string, field: string): SpecChange => {
  const found = report.changes.find((each) => each.operation === operation && each.field === field);
  if (found === undefined) throw new Error(`no change of ${operation} ${field}`);
  return found;
};

beforeAll(async () => {
  cpSync(join(FIXTURE, 'base'), project, { recursive: true });
  writeFileSync(
    config,
    JSON.stringify({
      services: [
        { name: 'catalog', repo: './catalog', type: 'nestjs' },
        { name: 'notifier', repo: './notifier', type: 'nestjs' },
        { name: 'dashboard', repo: './dashboard', type: 'react', apiBaseEnv: ['VITE_CATALOG_URL'], apiTarget: { VITE_CATALOG_URL: 'catalog' } },
      ],
      adapters: {
        broker: {
          custom: [
            {
              name: 'event-bus',
              channelKind: 'channel',
              producers: [{ receiverType: ['EventBus'], method: 'publish', channelArg: 0, payloadArg: 1, kind: 'event' }],
            },
          ],
        },
      },
      output: '.flowatlas',
    }),
  );
  for (const repo of ['catalog', 'notifier', 'dashboard']) {
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
  }
  cpSync(join(FIXTURE, 'head'), project, { recursive: true });
  git('catalog', 'add', '-A');
  git('catalog', 'commit', '-q', '-m', 'head');
  report = (await runSpecDiff('HEAD~1', undefined, { config, service: ['catalog'] }, quiet)).report;
  await runDiff('HEAD~1', undefined, { config, generatedAt: FIXED, spec: true }, quiet);
}, 300_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

describe('what a client sends and how it switches, in the verdicts (P402)', () => {
  it('is an error where a caller does not send a header now required, an info where every caller sends a query key now required', () => {
    const header = change('GET /items/search', 'header.x-tenant');
    expect(header.use?.level).toBe('error');
    expect(header.use?.readers[0]).toMatchObject({ how: 'omits', said: 'sends header accept; no `header.x-tenant`' });
    const query = change('GET /items', 'query.page');
    expect(query.use?.level).toBe('info');
    expect(query.use?.verdict).toBe('every caller sends `query.page`, among 1');
  });

  it('is an error where a switch with nothing left over meets a new value, a warning where a default takes it', () => {
    const kind = change('send item.changed', 'payload.kind');
    expect(kind.use?.level).toBe('error');
    expect(kind.use?.readers[0]?.said).toBe("switches over `kind`, line 18, exhaustively (its default proves no value is left): 'archived' is handled by no case");
    const status = change('GET /items/{id}', 'response.status');
    expect(status.use?.level).toBe('warning');
    expect(status.use?.readers[0]?.said).toBe("switches over `status`, line 6, with a default: 'sold' goes to it; whether that suits it is not read");
    expect(status.use?.deployOrder?.said).toBe("callers first: handle 'sold', then catalog");
  });

  it('says the verdicts in what_changed in the same words, and an API change a consumer feels makes the branch unsafe', () => {
    const read = readDiff(join(project, '.flowatlas', 'graph.db'));
    if ('error' in read) throw new Error(read.error);
    const said = summariseChanges(read.report, { maxNodes: 50, verdict: {} });
    expect(said.verdict).toBe('unsafe');
    expect(said.because).toContain('3 API changes a consumer in the project feels, listed under api');
    expect(said.counts.api).toEqual({ errors: 3, warnings: 1, infos: 2 });
    expect(said.api?.find((row) => row.operation === 'GET /items/search')).toEqual({
      level: 'error',
      operation: 'GET /items/search',
      field: 'header.x-tenant',
      verdict: '1 of 1 caller: sends header accept; no `header.x-tenant`',
      deploy: 'callers first: send `header.x-tenant`, then catalog',
    });
    const dashboard = summariseChanges(read.report, { maxNodes: 50, service: 'dashboard', verdict: {} });
    expect(dashboard.api?.map((row) => `${row.level} ${row.operation} ${row.field}`)).toEqual([
      'error GET /items/search header.x-tenant',
      'warning GET /items/{id} response.status',
    ]);
    expect(dashboard.counts.api).toEqual({ errors: 1, warnings: 1, infos: 1 });
  });
});
