import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT } from '../exit.js';
import { runDiff, type DiffRun } from './diff.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURES = join(ROOT, 'fixtures');
const FIXTURE = join(FIXTURES, 'multi-repo-diff');
const REPOS = ['orders', 'gateway', 'billing', 'web', 'bot'];
const EDITED = ['orders', 'billing'];
const FIXED = '2026-01-01T00:00:00.000Z';

// Beside the fixtures, so the copy still resolves the type stubs hoisted there,
// and its own, because these tests make git repositories and commit into them.
const scratch = mkdtempSync(join(FIXTURES, '.scratch-diff-'));
const project = join(scratch, 'project');
const config = join(project, 'flowatlas.config.json');
const quiet = { out(): void {}, err(): void {}, tty: false };

const git = (repo: string, ...args: string[]): void => {
  execFileSync('git', ['-C', join(project, repo), '-c', 'user.email=t@t', '-c', 'user.name=t', ...args]);
};

let run: DiffRun;

beforeAll(async () => {
  cpSync(join(FIXTURE, 'base'), project, { recursive: true });
  writeFileSync(
    config,
    JSON.stringify(
      {
        services: [
          { name: 'gateway', repo: './gateway', type: 'nestjs' },
          { name: 'orders', repo: './orders', type: 'nestjs', baseUrlEnv: ['ORDERS_URL'] },
          { name: 'billing', repo: './billing', type: 'nestjs', baseUrlEnv: ['BILLING_URL'] },
        ],
        output: '.flowatlas',
      },
      null,
      2,
    ),
  );
  for (const repo of REPOS) {
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
  }
  // The head revision, laid over the base as four files.
  cpSync(join(FIXTURE, 'head'), project, { recursive: true });
  for (const repo of EDITED) {
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'head');
  }
  run = await runDiff('HEAD~1', undefined, { config, generatedAt: FIXED }, quiet);
}, 300_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

describe('what a revision changed, across four repositories', () => {
  it('reads each repository at its own commit, and the untouched one at neither', () => {
    // A project is several repositories and a revision moves some of them. The
    // gateway was not touched, so both sides read the same tree and there is
    // nothing to compare there.
    const { base, head } = run.report;
    expect(base.services['orders']?.sha).not.toBeNull();
    expect(base.services['billing']?.sha).not.toBeNull();
    expect(base.services['gateway']?.sha).toBeNull();
    expect(head.services['gateway']?.sha).toBeNull();
  });

  it('says a required field was added, and that the caller does not send it', () => {
    // Neither repository stopped compiling. There is no compiler anywhere on
    // the path between them, which is the whole reason this exists.
    const broke = run.report.contracts.new;
    expect(broke).toHaveLength(1);
    expect(broke[0]).toMatchObject({
      severity: 'error',
      kind: 'missing_required',
      field: 'channel',
    });
  });

  it('does not call a finding fixed when somebody only annotated it', () => {
    // The two shapes still disagree. A person decided the disagreement is
    // deliberate, and a branch that annotates a break must not read like one
    // that repaired it.
    expect(run.report.contracts.fixed).toEqual([]);
    expect(run.report.contracts.ignored.length).toBeGreaterThan(0);
  });

  it('names a method that is gone, and walks the graph that still has it', () => {
    // The head graph has nothing to walk, so what reached it has to be read off
    // the base. A row that said nothing here would be saying a removal is safe.
    const gone = run.report.impact.find((row) => row.label.includes('legacy'));
    expect(gone).toBeDefined();
    expect(gone?.side).toBe('base');
    expect(gone?.service).toBe('orders');
  });

  it('says nothing about a file where only the lines moved', () => {
    // The controller's import was split over five lines, so every route in it
    // is declared five lines lower and not one of them changed.
    const labels = run.report.impact.map((row) => row.label);
    expect(labels.some((label) => label.includes('OrdersController'))).toBe(false);
  });

  it('stops a build on a break this revision introduced, when asked to', async () => {
    const strict = await runDiff(
      'HEAD~1',
      undefined,
      { config, generatedAt: FIXED, failOnContractBreak: true },
      quiet,
    );
    expect(strict.exitCode).toBe(EXIT.failed);
  }, 300_000);

  it('answers the same twice, whether it read the commits or remembered them', async () => {
    // The second run takes its graphs from the cache, which is the only thing
    // that should differ: what it found cannot.
    const again = await runDiff('HEAD~1', undefined, { config, generatedAt: FIXED }, quiet);
    expect(again.report.contracts).toEqual(run.report.contracts);
    expect(again.report.impact).toEqual(run.report.impact);
    expect(again.report.counts).toEqual(run.report.counts);
  }, 300_000);
});
