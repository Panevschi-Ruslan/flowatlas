import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseCheckReport, parseGraphDiff, type DiffReport } from '@flowatlas/linker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeDeployedProject } from '../../../../scripts/deployed-fixture.mjs';
import { EXIT } from '../exit.js';
import { sarifProblems } from '../sarif/schema-check.js';
import type { SarifLog } from '../sarif/types.js';
import { runCheck, type CheckCommandOptions, type CheckRun } from './check.js';
import { runDiff, type DiffOptions, type DiffRun } from './diff.js';

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
    // The file is an absolute path in the OS's own spelling (P199).
    expect(undecidable.sections.map((section) => basename(section.file))).toEqual(['check.prod.json', 'check.canary.json']);
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

/**
 * `flowatlas diff --env` (P193): `check`'s comparison without its verdict.
 * The base side is every service at its pin, read the way `check` reads it,
 * so the two documents agree section by section.
 */
describe('flowatlas diff --env (P193)', () => {
  const diffEnv = (head: string | undefined, options: Partial<DiffOptions>): Promise<DiffRun> =>
    runDiff(undefined, head, { config, generatedAt: FIXED, environ: {}, ...options }, quiet);
  const untimed = (report: DiffReport | null) => (report === null ? null : { ...report, timing: { baseMs: 0, headMs: 0, diffMs: 0, totalMs: 0 } });

  it('writes the document check carries under its verdict, for the same pins and the same branch', async () => {
    // Read once, so both runs below take every commit from the cache alike.
    await check({ env: ['prod'], service: ['orders'], head: 'drop-lookup' });
    const diff = await diffEnv('drop-lookup', { env: 'prod', service: ['orders'] });
    const checked = only(await check({ env: ['prod'], service: ['orders'], head: 'drop-lookup' }));
    expect(diff.exitCode).toBe(EXIT.ok);
    expect(diff.report.base.ref).toBe('prod');
    expect(diff.report.head.ref).toBe('drop-lookup');
    expect(diff.report.joins.lost.map((lost) => lost.kind).sort()).toEqual(['no-producer', 'target-gone']);
    expect(checked.diff).not.toBeNull();
    expect(untimed(diff.report)).toEqual(untimed(checked.diff));
    expect(untimed(parseGraphDiff(JSON.parse(readFileSync(diff.file, 'utf8'))))).toEqual(untimed(checked.diff));
    expect(diff.environment).toMatchObject({ environment: 'prod', pinsFile: 'flowatlas.deployed.json', notDeployed: [] });
    expect(diff.environment?.moved.map((move) => move.service)).toEqual(['orders']);
  }, 300_000);

  it('heads its Markdown with what the environment runs, and no verdict', async () => {
    const diff = await diffEnv('drop-lookup', { env: 'prod', service: ['orders'] });
    expect(diff.text.startsWith('## flowatlas diff\n\n`prod` → `drop-lookup`\n\nThe base side is what prod runs, pinned in `flowatlas.deployed.json`.\n')).toBe(true);
    expect(diff.text).toContain('| service | deployed | pinned by | head |');
    expect(diff.text).toMatch(/\| `orders` \| `v1` [0-9a-f]{8} \| file \| `drop-lookup` [0-9a-f]{8} \|/);
    expect(diff.text).not.toContain('deployable');
  }, 300_000);

  it('stops on a pin that does not resolve, and never reads the working tree in its place', async () => {
    await expect(diffEnv(undefined, { env: 'canary' })).rejects.toMatchObject({
      code: EXIT.cannotRun,
      message: expect.stringContaining('orders: v9 (from the pins file) does not resolve in ./orders'),
      details: [expect.stringContaining('git -C ./orders fetch --tags')],
    });
    await expect(diffEnv(undefined, { env: 'edge' })).rejects.toMatchObject({ code: EXIT.cannotRun, message: expect.stringContaining('no environment named "edge"') });
  }, 300_000);

  it('takes the environment or a base ref, never both, and pins only with an environment', async () => {
    await expect(runDiff('v1', undefined, { config, env: 'prod' }, quiet)).rejects.toMatchObject({ code: EXIT.cannotRun, message: expect.stringContaining('exclusive') });
    await expect(runDiff(undefined, undefined, { config }, quiet)).rejects.toMatchObject({ code: EXIT.cannotRun, message: expect.stringContaining('a base ref is required') });
    await expect(runDiff('v1', undefined, { config, pin: ['billing=main'] }, quiet)).rejects.toMatchObject({ code: EXIT.cannotRun, message: expect.stringContaining('need --env') });
    await expect(diffEnv(undefined, { env: 'not a name' })).rejects.toMatchObject({ code: EXIT.cannotRun });
  });

  it('lays --pin over the file, moves every service whose head differs without --service, and gates as diff does', async () => {
    const moved = await diffEnv(undefined, { env: 'prod' });
    expect(moved.environment?.moved.map((move) => move.service)).toEqual(['billing']);
    const pinned = await diffEnv('invoice-on-checkout', { env: 'prod', service: ['gateway'], pin: ['billing=main'], failOnContractBreak: true });
    expect(pinned.report.base.services['billing']).toMatchObject({ ref: 'main' });
    expect(pinned.environment?.notes).toContain('billing: main from --pin, in place of v1 from the pins file');
    expect(pinned.report.contracts.new).toContainEqual(expect.objectContaining({ kind: 'missing_required', field: 'currency' }));
    expect(pinned.exitCode).toBe(EXIT.failed);
  }, 300_000);
});
