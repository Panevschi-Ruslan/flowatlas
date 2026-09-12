import type { GraphDb } from '@flowatlas/linker';
import type { Unresolved } from '@flowatlas/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestProject } from '../test-graph.js';
import { snapshotOf, type Baseline } from './baseline.js';
import { runDoctor } from './run.js';
import { BASELINE_FORMAT_VERSION } from './schema.js';

// A real database, because `runDoctor` asks it questions. Which graph it holds
// does not matter here: every one of these is about the verdict.
let db: GraphDb;
beforeAll(() => {
  db = buildTestProject('doctor-verdict').db;
});
afterAll(() => db.close());
const dbOf = (): GraphDb => db;

const row = (over: Partial<Unresolved> = {}): Unresolved => ({
  service: 'orders',
  file: 'src/orders.service.ts',
  line: 12,
  reason: 'dynamic-http-url',
  ...over,
});

const baselineOf = (rows: readonly Unresolved[]): Baseline => ({
  baselineFormatVersion: BASELINE_FORMAT_VERSION,
  schemaVersion: 3,
  acceptedAt: '2026-01-01T00:00:00.000Z',
  acceptedBy: 'test',
  flowatlasVersion: '0.1.0',
  graph: { builtAt: '2026-01-01T00:00:00.000Z', services: {} },
  unresolved: snapshotOf(rows),
  markers: { warnings: 0 },
  contracts: { warnings: 0, infos: 0, ignored: 0 },
});

describe('what makes doctor fail a build', () => {
  it('says nothing is wrong when nothing is', () => {
    const report = runDoctor({ db: dbOf(), unresolved: [] }, { strict: true, contracts: false });
    expect(report.verdict).toEqual({ exitCode: 0, reasons: [] });
  });

  it('passes on findings alone, because a report is not a failure', () => {
    // Without --strict this command answers a question. Everything it found is
    // in the report; the exit code is about whether a build should stop.
    const report = runDoctor({ db: dbOf(), unresolved: [row(), row({ file: 'b.ts' })] }, { contracts: false });
    expect(report.verdict.exitCode).toBe(0);
  });

  it('fails when more rows are there than were accepted', () => {
    const report = runDoctor(
      { db: dbOf(), unresolved: [row(), row({ file: 'b.ts' })] },
      { strict: true, contracts: false, baseline: { baseline: baselineOf([row()]) }, baselinePath: '/x' },
    );
    expect(report.verdict.exitCode).toBe(1);
    expect(report.verdict.reasons.join(' ')).toMatch(/unresolved|grew|baseline/i);
  });

  it('passes when the same rows are there, wherever their lines have moved to', () => {
    const report = runDoctor(
      { db: dbOf(), unresolved: [row({ line: 400 })] },
      { strict: true, contracts: false, baseline: { baseline: baselineOf([row({ line: 12 })]) }, baselinePath: '/x' },
    );
    expect(report.verdict.exitCode).toBe(0);
  });

  it('leaves a missing baseline to the command, and reports rather than deciding', () => {
    // The report says what it found; whether that stops a build is the
    // command's call, and it is the one that turns this into exit 2. Asserted
    // here so the split stays deliberate rather than becoming an oversight.
    const report = runDoctor(
      { db: dbOf(), unresolved: [row()] },
      {
        strict: true,
        contracts: false,
        baseline: { status: 'missing', note: 'no baseline has been accepted' },
        baselinePath: '/x',
      },
    );
    expect(report.baseline.status).toBe('missing');
    expect(report.verdict.exitCode).toBe(0);
  });

  it('does not grow on an informational row, however many places it stands for', () => {
    // Nothing anybody writes in the repository removes one, so failing on it
    // would fail a build that cannot be fixed.
    const report = runDoctor(
      { db: dbOf(), unresolved: [row(), row({ level: 'info', sites: 333, file: 'x.ts' })] },
      { strict: true, contracts: false, baseline: { baseline: baselineOf([row()]) }, baselinePath: '/x' },
    );
    expect(report.verdict.exitCode).toBe(0);
  });
});
