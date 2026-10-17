import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MARKER_CODES } from '../doctor/markers.js';
import { FINDING_KINDS } from '@flowatlas/contracts';
import { describe, expect, it } from 'vitest';
import { CONTRACT_HELP, MARKER_HELP } from './catalogue.js';
import { sarifProblems } from './schema-check.js';

const ROOT = resolve(import.meta.dirname, '../../../..');

/**
 * Every SARIF log the snapshots record (P115), each checked against the
 * OASIS SARIF 2.1.0 JSON schema kept under `packages/cli/test-data/`.
 */
const SNAPSHOTS = [
  'fixtures/multi-repo-doctor/expected.doctor.sarif.json',
  'fixtures/multi-repo-contracts/expected.contracts.sarif.json',
  'fixtures/multi-repo/expected.cli/dead.sarif.json',
  'fixtures/multi-repo/expected.cli/cycles.sarif.json',
  'fixtures/multi-repo-rules/expected.cli/rules.sarif.json',
  'fixtures/multi-repo-diff/expected.cli/diff.sarif.json',
];

describe('the recorded SARIF logs (P115)', () => {
  it.each(SNAPSHOTS)('%s validates against the SARIF 2.1.0 schema', (path) => {
    const log = JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as unknown;
    expect(sarifProblems(log)).toEqual([]);
  });

  it('refuses a log that is not one, so the check above is a check', () => {
    expect(sarifProblems({ version: '2.1.0', runs: [{ results: [] }] })).not.toEqual([]);
  });

  it('describes every marker code and every contract finding kind', () => {
    expect(Object.keys(MARKER_HELP).sort()).toEqual([...MARKER_CODES].sort());
    expect(Object.keys(CONTRACT_HELP).sort()).toEqual([...FINDING_KINDS].sort());
  });
});
