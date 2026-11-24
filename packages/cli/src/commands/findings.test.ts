import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { QueryIo } from '../query/answer.js';
import { buildProject } from './build.js';
import { runContracts } from './contracts.js';
import { runFindings } from './findings.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const CONFIG = join(ROOT, 'fixtures', 'findings-between-services', 'flowatlas.config.json');

const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-findings-'));
let db = '';

beforeAll(async () => {
  const result = await buildProject({ config: CONFIG, out: scratch, builtAt: '2026-01-01T00:00:00.000Z' });
  db = result.dbPath;
}, 180_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

/** `flowatlas findings` (P384): what looks broken between the services first, each with its precision. */
describe('flowatlas findings', () => {
  it('lists the defects between the services first, each gated on its evidence, and holds back the rest with why', () => {
    const run = runFindings({ db, config: CONFIG });
    expect(run.rows[0]).toMatchObject({
      kind: 'call-to-missing-route',
      id: 'http_out:storefront#src/catalog.client.ts:25:26',
      precision: 'high',
      fix: 'the nearest route: POST /products/:param/publish (one segment off: release for publish)',
    });
    const kinds = run.rows.map((row) => row.kind);
    expect(kinds.indexOf('type-never-published')).toBeLessThan(kinds.indexOf('unguarded'));
    expect(run.rows.some((row) => row.id === 'http_out:storefront#src/legacy.client.ts:19:26')).toBe(false);
    expect(run.heldBack['call-to-missing-route']).toEqual({ count: 1, why: 'some routes of legacy-api were not read (route-path-dynamic)' });
    expect(run.lines).toContain('held back: 1 call-to-missing-route, the evidence not holding (some routes of legacy-api were not read (route-path-dynamic))');
    expect(run.failing).toBe(0);
  });

  it('fails on the findings at or above the precision asked, and on nothing below it', () => {
    const high = runFindings({ db, config: CONFIG, failOn: 'high' });
    expect(high.failing).toBe(high.rows.filter((row) => row.precision === 'high').length);
    expect(high.failing).toBeGreaterThan(0);
    expect(runFindings({ db, config: CONFIG, kind: 'unguarded', failOn: 'medium' }).failing).toBe(0);
    expect(() => runFindings({ db, config: CONFIG, failOn: 'certain' })).toThrow(/--fail-on must be one of high, medium, low/);
  });

  it('writes SARIF under a rule per kind carrying its precision, as loud as it is sure', () => {
    const { sarif } = runFindings({ db, config: CONFIG, format: 'sarif' });
    const run = sarif?.runs[0];
    const rule = run?.tool.driver.rules?.find((each) => each.id === 'finding/call-to-missing-route');
    expect(rule?.properties).toMatchObject({ precision: 'high' });
    const result = run?.results.find((each) => each.ruleId === 'finding/call-to-missing-route');
    expect(result?.level).toBe('error');
    expect(result?.message.text).toContain('the nearest route: POST /products/:param/publish');
    expect(run?.results.find((each) => each.ruleId === 'finding/unguarded')?.level).toBe('note');
  });
});

/** Contract breaks at warning counted, not listed (P395), on the fixture whose back office sends a draft of optional fields. */
describe('flowatlas findings, contract warnings', () => {
  const HOLD = join(ROOT, 'fixtures', 'findings-that-hold', 'flowatlas.config.json');
  const holdScratch = mkdtempSync(join(tmpdir(), 'flowatlas-findings-hold-'));
  let holdDb = '';
  const silent: QueryIo = { out: () => undefined, err: () => undefined, tty: false };

  beforeAll(async () => {
    holdDb = (await buildProject({ config: HOLD, out: holdScratch, builtAt: '2026-01-01T00:00:00.000Z' })).dbPath;
    runContracts({ db: holdDb, config: HOLD, format: 'json', out: holdScratch }, silent);
  }, 180_000);

  afterAll(() => rmSync(holdScratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

  it('lists the error, counts the warnings with the command that lists them, and lists them when asked', () => {
    const run = runFindings({ db: holdDb, config: HOLD });
    expect(run.rows.filter((row) => row.kind === 'contract-break').map((row) => row.severity)).toEqual(['error']);
    expect(run.warnings).toEqual({ 'contract-break': 7 });
    expect(run.lines).toContain('counted, not listed: 7 contract-break at warning (flowatlas findings --kind contract-break --severity warning)');
    const warnings = runFindings({ db: holdDb, config: HOLD, kind: 'contract-break', severity: 'warning' });
    expect(warnings.rows).toHaveLength(7);
    expect(warnings.warnings).toEqual({});
    expect(() => runFindings({ db: holdDb, config: HOLD, severity: 'info' })).toThrow(/--severity must be one of error, warning/);
  });
});
