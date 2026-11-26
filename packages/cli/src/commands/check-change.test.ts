import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkChangeAnswer } from '@flowatlas/mcp';
import { loadConfig } from '@flowatlas/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProject } from './build.js';
import { changedSinceBuild, checkWorkingTree, runCheckChange } from './check-change.js';

/**
 * `flowatlas check-change` (P387): the working tree against the graph already
 * built, reading only the services whose files changed since, or against a
 * base ref for the same services.
 */

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURES = join(ROOT, 'fixtures');
const FIXTURE = join(FIXTURES, 'edit-breaks-other-repos');

// Beside the fixtures, so the copy still resolves the type stubs hoisted there.
const scratch = mkdtempSync(join(FIXTURES, '.scratch-check-change-'));
const project = join(scratch, 'project');
const config = join(project, 'flowatlas.config.json');
const ROUTE = 'entry:catalog-api:http:PATCH:/items/:param/archive';

const git = (repo: string, ...args: string[]): void => {
  execFileSync('git', ['-C', join(project, repo), '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' });
};

let unchanged: string[];

beforeAll(async () => {
  cpSync(FIXTURE, project, { recursive: true, filter: (source) => !/[\\/](?:\.flowatlas|edits|expected\.[^\\/]+)$/.test(source) });
  git('catalog-api', 'init', '-q', '-b', 'main');
  git('catalog-api', 'add', '-A');
  git('catalog-api', 'commit', '-q', '-m', 'base');
  await buildProject({ config });
  unchanged = changedSinceBuild(loadConfig(config)).changed;
  // The archive route renamed and `sku` sent under another key, not committed and not built.
  cpSync(join(FIXTURE, 'edits'), project, { recursive: true });
}, 120_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

describe('check-change', () => {
  it('reads nothing again when nothing changed since the build', () => {
    expect(unchanged).toEqual([]);
  });

  it('reads only the service whose files changed, and finds the call that lost its route', async () => {
    const check = await checkWorkingTree(loadConfig(config), {});
    expect(check.read).toEqual(['catalog-api']);
    expect(check.report.joins.lost.map((join) => [join.caller, join.target, join.now])).toEqual([
      ['http_out:storefront#src/catalog.client.ts:25:26', ROUTE, 'target-route-not-found'],
    ]);
    const answer = checkChangeAnswer(check, { maxNodes: 10 }) as Record<string, any>;
    expect(answer.verdict).toBe('unsafe');
    expect(answer.compared).toMatch(/^working tree against built graph/);
    expect(answer.retest.map((row: { id: string }) => row.id)).toEqual(['entry:storefront:http:DELETE:/shop/items/:param']);
  }, 120_000);

  it('compares with a base ref for the services that differ from it', async () => {
    const check = await checkWorkingTree(loadConfig(config), { base: 'HEAD' });
    expect(check.read).toEqual(['catalog-api']);
    expect(check.report.base.ref).toBe('HEAD');
    expect(check.report.joins.lost.map((join) => join.target)).toEqual([ROUTE]);
  }, 120_000);

  it('reads only the services named, which here changed nothing, and refuses one there is none of', async () => {
    const check = await checkWorkingTree(loadConfig(config), { services: ['alerts-bot'] });
    expect(check.read).toEqual(['alerts-bot']);
    expect(check.report.joins.lost).toEqual([]);
    await expect(checkWorkingTree(loadConfig(config), { services: ['payments'] })).rejects.toThrow(/no service named "payments"; the services are catalog-api, storefront, alerts-bot/);
  }, 120_000);

  it('prints the verdict and what it rests on as text', async () => {
    const out: string[] = [];
    await runCheckChange({ config }, { out: (text) => void out.push(text), err: () => {} });
    const text = out.join('');
    expect(text).toMatch(/^unsafe: working tree against built graph/);
    expect(text).toContain('lost what they joined (1):');
    expect(text).toContain('ways in the change reaches (1):');
  }, 120_000);
});
