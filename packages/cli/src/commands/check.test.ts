import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseCheckReport } from '@flowatlas/linker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeDeployedProject } from '../../../../scripts/deployed-fixture.mjs';
import { EXIT } from '../exit.js';
import { sarifProblems } from '../sarif/schema-check.js';
import type { SarifLog } from '../sarif/types.js';
import { runCheck, type CheckCommandOptions, type CheckRun } from './check.js';
import { runDiff } from './diff.js';

/**
 * `flowatlas check --env` (P117) over `fixtures/multi-repo-deployed`: prod
 * runs `v1` of all three services, staging `main` (billing one commit ahead,
 * requiring a `currency` and publishing `invoice.paid`), and canary a tag of
 * orders that was never made.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXED = '2026-01-01T00:00:00.000Z';
const quiet = { out(): void {}, err(): void {}, tty: false };

let scratch: string;
let project: string;
let config: string;
const check = (options: Partial<CheckCommandOptions>): Promise<CheckRun> =>
  runCheck({ config, generatedAt: FIXED, environ: {}, ...options }, quiet);
const only = (run: CheckRun) => {
  const section = run.sections[0];
  if (section === undefined) throw new Error('no section');
  return section.report;
};

beforeAll(() => {
  ({ scratch, project, config } = makeDeployedProject(ROOT));
});

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

describe('flowatlas check --env (P117)', () => {
  it('says the same branch is deployable against prod and not against staging, for the reason planted', async () => {
    const options = { service: ['gateway'], head: 'invoice-on-checkout' };
    const prod = await check({ ...options, env: ['prod'] });
    const staging = await check({ ...options, env: ['staging'] });
    expect(prod.exitCode).toBe(EXIT.ok);
    expect(only(prod).verdict.verdict).toBe('deployable');
    expect(staging.exitCode).toBe(EXIT.failed);
    expect(only(staging).verdict.reasons).toEqual([
      expect.objectContaining({
        kind: 'contract',
        code: 'missing_required',
        service: 'gateway',
        at: { service: 'gateway', file: 'src/clients/billing.client.ts', line: 15 },
        heuristic: false,
      }),
    ]);
    expect(only(staging).verdict.reasons[0]?.message).toContain('currency');
  }, 300_000);

  it('names a route removal a deployed caller still uses, at the caller\'s file and line', async () => {
    const report = only(await check({ env: ['prod'], service: ['orders'], head: 'drop-lookup' }));
    expect(report.verdict.verdict).toBe('not deployable');
    expect(report.verdict.reasons).toContainEqual(
      expect.objectContaining({
        kind: 'join',
        code: 'target-gone',
        service: 'gateway',
        at: { service: 'gateway', file: 'src/clients/orders.client.ts', line: 21 },
      }),
    );
    expect(report.moved).toEqual([
      expect.objectContaining({ service: 'orders', from: expect.objectContaining({ ref: 'v1' }), to: expect.objectContaining({ ref: 'drop-lookup', dirty: false }) }),
    ]);
  }, 300_000);

  it('names a new handler of what nothing deployed publishes, in prod and not in staging', async () => {
    const prod = only(await check({ env: ['prod'], service: ['orders'], head: 'drop-lookup' }));
    const staging = only(await check({ env: ['staging'], service: ['orders'], head: 'drop-lookup' }));
    const unproduced = (report: typeof prod) => report.verdict.reasons.filter((reason) => reason.code === 'no-producer');
    expect(unproduced(prod)).toEqual([expect.objectContaining({ service: 'orders', at: expect.objectContaining({ file: 'src/orders/invoice-paid.consumer.ts' }) })]);
    expect(unproduced(staging)).toEqual([]);
  }, 300_000);

  it('lists what already runs wrong and never fails on it', async () => {
    const report = only(await check({ env: ['prod'], service: ['gateway'], head: 'invoice-on-checkout' }));
    expect(report.verdict.verdict).toBe('deployable');
    expect(report.verdict.already.map((reason) => `${reason.kind}:${reason.code}`).sort()).toEqual(['contract:missing_required', 'rule:billing-reads-no-order-events']);
  }, 300_000);

  it('refuses to decide on a pin that does not resolve, and never reads the working tree in its place', async () => {
    const run = await check({ env: ['canary'] });
    const report = only(run);
    expect(run.exitCode).toBe(EXIT.cannotRun);
    expect(report.verdict.verdict).toBe('undecided');
    expect(report.diff).toBeNull();
    expect(report.verdict.undecided).toEqual([
      expect.objectContaining({ reason: 'ref-not-found', service: 'orders', hint: expect.stringContaining('git -C ./orders fetch --tags') }),
    ]);
    expect(report.pins.find((pin) => pin.service === 'orders')).toMatchObject({ ref: 'v9', sha: null });
  }, 300_000);

  it('answers each environment of a matrix in its own section, and exits with the worst', async () => {
    const both = await check({ env: ['prod', 'staging'], service: ['gateway'], head: 'invoice-on-checkout' });
    expect(both.sections.map((section) => section.report.verdict.verdict)).toEqual(['deployable', 'not deployable']);
    expect(both.exitCode).toBe(EXIT.failed);
    const undecidable = await check({ env: ['prod', 'canary'], service: ['gateway'], head: 'invoice-on-checkout' });
    expect(undecidable.exitCode).toBe(EXIT.cannotRun);
    expect(undecidable.sections.map((section) => section.file.split('/').pop())).toEqual(['check.prod.json', 'check.canary.json']);
  }, 300_000);

  it('says there is nothing to deploy for a service whose head is its pin', async () => {
    const run = await check({ env: ['prod'], service: ['orders'] });
    expect(run.exitCode).toBe(EXIT.ok);
    expect(only(run).moved).toEqual([]);
    expect(only(run).verdict.notes).toContainEqual(expect.stringMatching(/^nothing to deploy for orders: its working tree is v1 \([0-9a-f]{8}\)$/));
  }, 300_000);

  it('moves, without --service, every service whose head differs from its pin', async () => {
    const report = only(await check({ env: ['prod'] }));
    expect(report.moved.map((move) => move.service)).toEqual(['billing']);
    // Nothing deployed calls POST /invoices yet, so the required currency breaks nobody.
    expect(report.verdict.verdict).toBe('deployable');
  }, 300_000);

  it('lays --pin and FLOWATLAS_PIN_* over the file, and says whose ref it used', async () => {
    const report = only(
      await check({ env: ['prod'], service: ['gateway'], head: 'invoice-on-checkout', pin: ['billing=main'], environ: { FLOWATLAS_PIN_BILLING: 'v1' } }),
    );
    // The flag wins: billing main requires the currency the branch does not send.
    expect(report.verdict.verdict).toBe('not deployable');
    expect(report.pins.find((pin) => pin.service === 'billing')).toMatchObject({ ref: 'main', from: 'flag', replaced: { ref: 'v1', from: 'env' } });
    expect(report.verdict.notes).toContainEqual('billing: main from --pin, in place of v1 from FLOWATLAS_PIN_*');
  }, 300_000);

  it('checks an environment the file never names from pins alone, and leaves out what it does not run', async () => {
    const report = only(await check({ env: ['edge'], service: ['gateway'], head: 'invoice-on-checkout', pin: ['gateway=v1', 'orders=v1'] }));
    expect(report.notDeployed).toEqual(['billing']);
    // billing runs nowhere here, so nothing answers the new request: a join never made, said as one.
    expect(report.verdict.reasons).toEqual([
      expect.objectContaining({ kind: 'join', code: 'no-target', service: 'gateway', at: expect.objectContaining({ file: 'src/clients/billing.client.ts' }) }),
    ]);
    const unknown = await check({ env: ['edge'] });
    expect(unknown.exitCode).toBe(EXIT.cannotRun);
    expect(only(unknown).verdict.undecided[0]).toMatchObject({ reason: 'unknown-environment' });
  }, 300_000);

  it('writes a check document every reader of a diff reads, and a SARIF log that validates', async () => {
    const run = await check({ env: ['prod'], service: ['orders'], head: 'drop-lookup', format: 'sarif' });
    const section = run.sections[0];
    const report = parseCheckReport(JSON.parse(readFileSync(section?.file ?? '', 'utf8')));
    expect(report.checkFormatVersion).toBe(1);
    expect(report.diff?.base.ref).toBe('prod');
    expect(report.diff?.joins.lost.length).toBe(2);
    const log = JSON.parse(run.text) as SarifLog;
    expect(sarifProblems(log)).toEqual([]);
    expect(log.runs[0]?.automationDetails.id).toBe('flowatlas/check/');
    expect(log.runs[0]?.results.map((result) => result.ruleId).sort()).toEqual(['join/no-producer', 'join/target-gone']);
  }, 300_000);

  it('reads the same graph cache as diff: a pinned tag read once is read once', async () => {
    await check({ env: ['prod'], service: ['orders'], head: 'drop-lookup' });
    const again = only(await check({ env: ['prod'], service: ['orders'], head: 'drop-lookup' }));
    expect(Object.values(again.diff?.base.services ?? {}).every((source) => source.cached)).toBe(true);
    const diff = await runDiff('v1', undefined, { config, generatedAt: FIXED }, quiet);
    expect(diff.report.base.services['gateway']).toMatchObject({ ref: 'v1', cached: true });
  }, 300_000);

  it('counts uncommitted work in the working tree as something to deploy', async () => {
    const file = join(project, 'orders', 'src', 'orders', 'orders.controller.ts');
    const before = readFileSync(file, 'utf8');
    try {
      writeFileSync(file, before.replace("@Get(':id')", "@Get(':id/summary')"));
      const report = only(await check({ env: ['prod'], service: ['orders'] }));
      expect(report.moved).toEqual([expect.objectContaining({ service: 'orders', to: { ref: null, sha: null, dirty: true } })]);
      expect(report.verdict.verdict).toBe('not deployable');
    } finally {
      writeFileSync(file, before);
      execFileSync('git', ['-C', join(project, 'orders'), 'status', '--porcelain']);
    }
  }, 300_000);
});
