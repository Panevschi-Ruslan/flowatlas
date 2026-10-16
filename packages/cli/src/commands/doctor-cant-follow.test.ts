import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDoctorReport } from '../doctor/schema.js';
import { runCantFollowCommand, runDoctorCommand } from './doctor.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'cant-follow', 'flowatlas.config.json');

const quiet = { out(): void {}, err(): void {}, tty: false };

describe('doctor --unresolved', () => {
  it('accounts for every place the report counts, no more and no fewer', () => {
    const { report: doctor } = runDoctorCommand({ config: CONFIG }, quiet);
    const { report } = runCantFollowCommand({ config: CONFIG }, quiet);
    expect(report.total).toEqual({ rows: doctor.unresolved.rows, sites: doctor.unresolved.sites });
    expect(report.causes.reduce((sum, cause) => sum + cause.sites, 0)).toBe(report.total.sites);
    parseDoctorReport(doctor);
  });

  it('leads with the packages nobody installed, each with places to open', () => {
    const { report, text } = runCantFollowCommand({ config: CONFIG }, quiet);
    const [first] = report.causes;
    expect(first?.cause).toBe('module-not-installed');
    expect(first?.packages[0]).toMatchObject({ package: '@shopkit/mailer', sites: 7 });
    expect(first?.packages[0]?.samples[0]).toMatchObject({ service: 'storefront', file: 'src/notify/notify.service.ts' });
    expect(text).toContain('module-not-installed:@shopkit/mailer: 7 places');
    expect(text).toContain('storefront/src/notify/notify.service.ts:19');
  });

  it('names every cause the fixture was written to show', () => {
    const { report } = runCantFollowCommand({ config: CONFIG, top: '50' }, quiet);
    expect(report.causes.map((cause) => cause.cause).sort()).toEqual([
      'any-typed',
      'callback-param',
      'dynamic-member',
      'import-unresolved',
      'interface-type',
      'module-not-installed',
      're-export-missing',
      'untyped-parameter',
    ]);
  });

  it('says what it cut, and narrows to a package', () => {
    const cut = runCantFollowCommand({ config: CONFIG, top: '2' }, quiet);
    expect(cut.report.truncated?.causes).toBe(6);
    expect(cut.text).toMatch(/6 more causes and 3 more packages; --top 4 lists more/);
    const ledger = runCantFollowCommand({ config: CONFIG, package: '@shopkit/ledger', json: true }, quiet);
    expect(JSON.parse(ledger.text)).toMatchObject({ package: '@shopkit/ledger', total: { sites: 4 } });
  });
});
