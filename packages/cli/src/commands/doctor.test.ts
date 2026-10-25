import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import { afterAll, describe, expect, it } from 'vitest';
import { CliError, EXIT } from '../exit.js';
import { nearestReasons } from '../doctor/hints.js';
import { boundDoctorReport } from '../doctor/run.js';
import { parseDoctorReport, type DoctorReport } from '../doctor/schema.js';
import { doctorCommandForReason } from '../visualise/steps.js';
import { DOCTOR_FILE, registerDoctor, runCantFollowCommand, runDoctorCommand, type DoctorOptions } from './doctor.js';

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

// One reason in this fixture, `unknown-db-package`, has nine places: more than
// the six a reason lists on the terminal, so the cut and the file can differ.
describe('what doctor.json keeps (P192)', () => {
  const out = mkdtempSync(join(tmpdir(), 'flowatlas-doctor-complete-'));
  afterAll(() => rmSync(out, { recursive: true, force: true }));
  const READ = { config: CONFIG, baseline: join(FIXTURE, 'baseline.accepted.json'), out };
  const groupOf = (report: DoctorReport) =>
    report.unresolved.byReason.find((group) => group.reason === 'unknown-db-package' && group.level === 'action');

  it('every row of every reason, where the printed report lists six and says how many more', () => {
    const run = runDoctorCommand(READ, quiet);
    const written = parseDoctorReport(JSON.parse(readFileSync(join(out, DOCTOR_FILE), 'utf8')));
    expect(groupOf(written)?.count).toBe(9);
    expect(groupOf(written)?.rows).toHaveLength(9);
    expect(groupOf(run.report)?.rows).toHaveLength(6);
    expect(groupOf(run.report)?.truncated).toBe(3);
    expect(run.text).toContain(`… 3 more rows; the whole list is in ${join(out, DOCTOR_FILE)}`);
    // The file is the complete report the command returns, and no cut is in it.
    expect(written).toEqual(run.complete);
    expect(readFileSync(join(out, DOCTOR_FILE), 'utf8')).not.toContain('"truncated"');
  });

  it('is complete under --max-nodes too, and --format json still prints the cut', () => {
    const run = runDoctorCommand({ ...READ, maxNodes: '1', format: 'json' }, quiet);
    const printed = JSON.parse(run.text) as DoctorReport;
    expect(groupOf(printed)?.rows).toHaveLength(1);
    expect(groupOf(printed)?.truncated).toBe(8);
    expect(printed.markers.issues).toHaveLength(1);
    expect(printed.markers.truncated).toBe(run.complete.markers.issues.length - 1);
    const written = JSON.parse(readFileSync(join(out, DOCTOR_FILE), 'utf8')) as DoctorReport;
    expect(groupOf(written)?.rows).toHaveLength(9);
    expect(written.markers.issues).toHaveLength(run.complete.markers.issues.length);
    expect(written.markers.issues.length).toBeGreaterThan(1);
  });

  it('cuts the way the check used to, so the printed report is unchanged', () => {
    const complete = runDoctorCommand(READ, quiet).complete;
    const bounded = boundDoctorReport(complete);
    expect(bounded.unresolved.byReason.every((group) => group.rows.length <= 6)).toBe(true);
    expect(bounded.unresolved.byReason.map((group) => group.count)).toEqual(
      complete.unresolved.byReason.map((group) => group.count),
    );
    expect(bounded.markers.errors).toBe(complete.markers.errors);
    expect(bounded.contracts.errorCount).toBe(complete.contracts.errorCount);
  });
});

describe('doctor --reason (P141)', () => {
  const reasonsOf = (report: DoctorReport): string[] => [
    ...new Set(report.unresolved.byReason.map((group) => group.reason)),
  ];

  it('keeps only that reason, under each level it is at, with the sections made of rows', () => {
    const run = runDoctorCommand({ config: CONFIG, reason: ['dynamic-http-url'] }, quiet);
    expect(reasonsOf(run.report)).toEqual(['dynamic-http-url']);
    expect(run.report.unresolved.byReason.map((group) => group.level).sort()).toEqual(['action', 'info']);
    expect(run.report.sections).toEqual(['unresolved', 'desync']);
    expect(run.report.markers.status).toBe('skipped');
    expect(run.report.contracts.status).toBe('skipped');
    expect(run.text).not.toMatch(/unknown-db-package|route-unguarded|^markers:/m);
    expect(run.text).toContain('dynamic-http-url');
    expect(run.exitCode).toBe(EXIT.ok);
  });

  it('says the same as data, with --max-nodes as it was', () => {
    const run = runDoctorCommand(
      { config: CONFIG, reason: ['unknown-db-package'], format: 'json', maxNodes: '20' },
      quiet,
    );
    const printed = JSON.parse(run.text) as DoctorReport;
    expect(reasonsOf(printed)).toEqual(['unknown-db-package']);
    expect(printed.unresolved.byReason[0]?.rows).toHaveLength(9);
    expect(printed.unresolved.byReason[0]?.truncated).toBeUndefined();
    expect(printed.unresolved.total).toBe(9);
  });

  it('takes two reasons, repeated or as a comma list', () => {
    const repeated = runDoctorCommand({ config: CONFIG, reason: ['route-unguarded', 'di-token-unknown'] }, quiet);
    const listed = runDoctorCommand({ config: CONFIG, reason: ['route-unguarded, di-token-unknown'] }, quiet);
    expect(reasonsOf(repeated.report).sort()).toEqual(['di-token-unknown', 'route-unguarded']);
    expect(listed.report.unresolved).toEqual(repeated.report.unresolved);
  });

  it('answers none for a reason the catalogue knows and no row here carries', () => {
    const run = runDoctorCommand({ config: CONFIG, reason: ['query-in-loop'] }, quiet);
    expect(run.report.unresolved.byReason).toEqual([]);
    expect(run.text).toContain('unresolved: none');
  });

  it('stops on a reason nobody knows, and names the nearest', () => {
    let thrown: unknown;
    try {
      runDoctorCommand({ config: CONFIG, reason: ['unknown-db-pakage'] }, quiet);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CliError);
    expect((thrown as CliError).code).toBe(EXIT.cannotRun);
    expect((thrown as CliError).message).toContain('"unknown-db-pakage"');
    expect((thrown as CliError).details.join('\n')).toContain('unknown-db-package');
  });

  // The page's Not joined tab writes this line under a reason with more places
  // than it lists (P137): read by the command's own options, it lists them all.
  it('lists every place for the line the page writes', () => {
    const line = doctorCommandForReason('unknown-db-package', Array.from({ length: 9 }, () => 'orders'), 9);
    expect(line).toBe('flowatlas doctor --reason unknown-db-package --max-nodes 9 --service orders');
    const program = new Command();
    registerDoctor(program);
    const doctor = program.commands.find((command) => command.name() === 'doctor') as Command;
    doctor.parseOptions(line.split(' ').slice(2));
    const run = runDoctorCommand({ ...(doctor.opts() as DoctorOptions), config: CONFIG }, quiet);
    expect(run.report.unresolved.byReason.map((group) => group.reason)).toEqual(['unknown-db-package']);
    expect(run.report.unresolved.byReason[0]?.rows).toHaveLength(9);
    expect(run.report.unresolved.byReason[0]?.truncated).toBeUndefined();
    expect(run.text).not.toContain('more rows');
  });

  it('refuses --accept, which is about the whole project', () => {
    expect(() => runDoctorCommand({ config: CONFIG, reason: ['route-unguarded'], accept: true }, quiet)).toThrow(
      /--accept refuses --reason/,
    );
  });

  it('narrows --unresolved the same way, and says so', () => {
    const whole = runCantFollowCommand({ config: CONFIG, json: true }, quiet);
    const one = runCantFollowCommand({ config: CONFIG, reason: ['unknown-db-package'], json: true }, quiet);
    expect(one.report.reasons).toEqual(['unknown-db-package']);
    expect(whole.report.reasons).toBeNull();
    expect(one.report.total.rows).toBe(9);
    expect(one.report.total.rows).toBeLessThan(whole.report.total.rows);
    expect(runCantFollowCommand({ config: CONFIG, reason: ['unknown-db-package'] }, quiet).text).toContain(
      '(reason unknown-db-package)',
    );
  });
});

describe('the nearest reasons to one nobody registered', () => {
  it('are the ones a few edits away, or that contain it', () => {
    expect(nearestReasons('unknown-db-pakage', ['unknown-db-package', 'route-unguarded'])).toEqual([
      'unknown-db-package',
    ]);
    expect(nearestReasons('unguarded', ['route-unguarded', 'unknown-db-package'])).toEqual(['route-unguarded']);
    expect(nearestReasons('zzzz', ['route-unguarded'])).toEqual([]);
  });
});
