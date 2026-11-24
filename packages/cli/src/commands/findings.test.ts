import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildProject } from './build.js';
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
