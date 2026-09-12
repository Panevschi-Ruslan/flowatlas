import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT } from '../exit.js';
import { runDoctorCommand } from './doctor.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURE = join(ROOT, 'fixtures', 'multi-repo-doctor');
const CONFIG = join(FIXTURE, 'flowatlas.config.json');

const quiet = { out(): void {}, err(): void {}, tty: false };

const strictAgainst = (baseline: string) =>
  runDoctorCommand({ config: CONFIG, strict: true, baseline: join(FIXTURE, baseline) }, quiet);

// This fixture is built with annotations that are wrong on purpose, so a strict
// run over it fails on those whatever the baseline says. What each of the three
// baselines settles is the growth check, so that is what these assert.
describe('what a strict run answers about growth', () => {
  it('is unmoved against the baseline that was accepted from it', () => {
    const { report } = strictAgainst('baseline.accepted.json');
    expect(report.baseline.status).toBe('ok');
    expect(report.baseline.total.delta).toBe(0);
  });

  it('names both ends when a row moved to another file, and still passes', () => {
    // Nothing got worse: one row went and one arrived. A reader still wants to
    // know which, so both are named, and the build is not stopped for it.
    const { report } = strictAgainst('baseline.moved.json');
    expect(report.baseline.status).toBe('ok');
    expect(report.baseline.total.delta).toBe(0);
    expect(report.baseline.newKeys).toHaveLength(1);
    expect(report.baseline.goneKeys).toHaveLength(1);
    expect(report.baseline.newKeys[0]).toContain('app.module.ts');
  });

  it('fails when there is a row more than was accepted', () => {
    const { report, exitCode } = strictAgainst('baseline.smaller.json');
    expect(report.baseline.status).toBe('grew');
    expect(report.baseline.total.delta).toBeGreaterThan(0);
    expect(exitCode).toBe(EXIT.failed);
  });

  it('refuses to answer at all with no baseline to answer against', () => {
    // Green here would mean "nothing got worse" on no evidence, which is the
    // one answer a gate must never give.
    const run = runDoctorCommand(
      { config: CONFIG, strict: true, baseline: join(FIXTURE, 'baseline.nothing-here.json') },
      quiet,
    );
    expect(run.exitCode).toBe(EXIT.cannotRun);
    expect(run.report.verdict.reasons.join(' ')).toMatch(/--no-baseline/);
  });

  it('checks the annotations and the contracts when told to skip the baseline', () => {
    const run = runDoctorCommand({ config: CONFIG, strict: true, baseline: false }, quiet);
    expect(run.report.baseline.status).toBe('skipped');
    // This fixture is built to have failing annotations, so a strict run that
    // reached them has something to say.
    expect(run.exitCode).toBe(EXIT.failed);
    expect(run.report.verdict.reasons.join(' ')).toMatch(/annotation|marker|contract/i);
  });

  it('reports without failing when nothing asked it to be strict', () => {
    const run = runDoctorCommand({ config: CONFIG }, quiet);
    expect(run.exitCode).toBe(EXIT.ok);
    expect(run.report.markers.issues.length).toBeGreaterThan(0);
  });
});
