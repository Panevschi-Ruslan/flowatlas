import { copyFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DECLARED_UNSEEN, SEEN_UNDECLARED } from '../doctor/runtime.js';
import { EXIT } from '../exit.js';
import { runDoctorCommand, type DoctorOptions } from './doctor.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURE = join(ROOT, 'fixtures', 'multi-repo');
const CONFIG = join(FIXTURE, 'flowatlas.config.json');

const quiet = { out(): void {}, err(): void {}, tty: false };

/**
 * The multi-repo graph with the observed file `flowatlas observe` wrote over
 * its traces (the CLI's `observe.json` snapshot) beside a copy of it, and the
 * same graph without one (P106).
 */
const seen = mkdtempSync(join(tmpdir(), 'flowatlas-doctor-runtime-'));
cpSync(join(FIXTURE, '.flowatlas'), seen, { recursive: true });
copyFileSync(join(FIXTURE, 'expected.cli', 'observe.json'), join(seen, 'observed.json'));
const bare = mkdtempSync(join(tmpdir(), 'flowatlas-doctor-runtime-bare-'));
cpSync(join(FIXTURE, '.flowatlas'), bare, { recursive: true });
afterAll(() => {
  rmSync(seen, { recursive: true, force: true });
  rmSync(bare, { recursive: true, force: true });
});

const doctorOn = (dir: string, extra: Partial<DoctorOptions> = {}) =>
  runDoctorCommand({ config: CONFIG, db: join(dir, 'graph.db'), out: dir, baseline: false, contracts: false, ...extra }, quiet);

const groupOf = (run: ReturnType<typeof doctorOn>, reason: string) =>
  run.report.unresolved.byReason.find((group) => group.reason === reason);

describe('failures traffic answered, in doctor (P106)', () => {
  it('lists a status no failure declares at the handler, and a declared one nobody answered at the throw, at info', () => {
    const run = doctorOn(seen);
    const undeclared = groupOf(run, SEEN_UNDECLARED);
    const unseen = groupOf(run, DECLARED_UNSEEN);
    expect(undeclared?.level).toBe('info');
    expect(unseen?.level).toBe('info');
    const messages = JSON.stringify(run.report.unresolved.byReason);
    expect(messages).toContain('POST /orders answered 500 to 1 of 1 requests');
    expect(messages).toContain('POST /invoices declares 409 ConflictException');
    // The 404 GET /invoices/:id declares and answered is neither.
    expect(messages).not.toContain('GET /invoices/:param answered 404');
    expect(run.exitCode).toBe(EXIT.ok);
  });

  it('adds nothing without an observed file, and moves neither the exit code nor the baseline counts with one', () => {
    const without = doctorOn(bare);
    expect(groupOf(without, SEEN_UNDECLARED)).toBeUndefined();
    expect(groupOf(without, DECLARED_UNSEEN)).toBeUndefined();
    const withRows = doctorOn(seen);
    expect(withRows.report.unresolved.total).toBe(without.report.unresolved.total);
    expect(withRows.exitCode).toBe(without.exitCode);
    expect(doctorOn(seen, { strict: true }).exitCode).toBe(doctorOn(bare, { strict: true }).exitCode);
  });

  it('exits 1 under --strict-runtime, saying why, and only with an observed file', () => {
    const strict = doctorOn(seen, { strictRuntime: true });
    expect(strict.exitCode).toBe(EXIT.failed);
    expect(strict.report.verdict.reasons.join(' ')).toMatch(/traffic answered and the code does not declare.*--strict-runtime/);
    expect(doctorOn(bare, { strictRuntime: true }).exitCode).toBe(EXIT.ok);
    // Narrowed to a service none of whose ways in was seen failing, nothing counts.
    expect(doctorOn(seen, { strictRuntime: true, service: 'web' }).exitCode).toBe(EXIT.ok);
  });
});
