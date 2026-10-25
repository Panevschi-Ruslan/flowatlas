import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runContracts } from '../commands/contracts.js';
import { runDoctorCommand } from '../commands/doctor.js';
import { CliError, EXIT } from '../exit.js';
import { sarifProblems } from './schema-check.js';
import type { SarifLog } from './types.js';

/**
 * `--format sarif` on the commands (P115): the log validates, `--output`
 * writes it and says one line, and the format never decides a verdict.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const DOCTOR = join(ROOT, 'fixtures', 'multi-repo-doctor');
const CONTRACTS = join(ROOT, 'fixtures', 'multi-repo-contracts', 'flowatlas.config.json');
const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-sarif-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const captured = (): { io: { out(text: string): void; err(): void; tty: false }; said: () => string } => {
  let text = '';
  return { io: { out: (more) => void (text += more), err: () => undefined, tty: false }, said: () => text };
};

describe('--format sarif (P115)', () => {
  it('doctor: writes the log to --output, says one line, and exits as the text report does', () => {
    const options = { config: join(DOCTOR, 'flowatlas.config.json'), strict: true, baseline: join(DOCTOR, 'baseline.accepted.json'), out: scratch };
    const asText = runDoctorCommand(options, captured().io);
    const output = join(scratch, 'doctor.sarif');
    const { io, said } = captured();
    const asSarif = runDoctorCommand({ ...options, format: 'sarif', output }, io);
    expect(asSarif.exitCode).toBe(asText.exitCode);
    expect(asSarif.exitCode).toBe(EXIT.failed);
    expect(said()).toMatch(/^sarif: \d+ results \(\d+ error, \d+ warning, \d+ note\) written to .*doctor\.sarif\n$/);
    const log = JSON.parse(readFileSync(output, 'utf8')) as SarifLog;
    expect(sarifProblems(log)).toEqual([]);
    expect(log.runs[0]?.automationDetails.id).toBe('flowatlas/doctor/');
    // The annotations the graph contradicts are errors at the line they are written on.
    expect(log.runs[0]?.results.some((result) => result.ruleId === 'marker-emits-without-emit' && result.level === 'error')).toBe(true);
  });

  it('contracts: --fail-on decides the exit, whatever the format', () => {
    const text = runContracts({ config: CONTRACTS, failOn: 'error', out: scratch }, captured().io);
    const { io, said } = captured();
    const sarif = runContracts({ config: CONTRACTS, failOn: 'error', out: scratch, format: 'sarif' }, io);
    expect(sarif.exitCode).toBe(text.exitCode);
    expect(sarifProblems(JSON.parse(said()))).toEqual([]);
  });

  it('refuses a --sarif-level it does not know', () => {
    expect(() => runContracts({ config: CONTRACTS, format: 'sarif', sarifLevel: 'loud' }, captured().io)).toThrow(CliError);
  });
});
