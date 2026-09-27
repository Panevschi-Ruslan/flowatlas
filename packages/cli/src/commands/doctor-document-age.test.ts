import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runDoctorCommand } from './doctor.js';

/**
 * The age of a declared document, as `doctor` reports it over a real graph.
 *
 * `document-age` is worked out when `doctor` runs and never enters a graph, so
 * no fixture snapshot can hold it, and `doctor/age.test.ts` asks the row-maker
 * with the dates handed in. What that leaves unasked is the wiring: that the
 * configuration's `document.kind` reaches the sentence, and that a project which
 * silenced the reason under its old name, `openapi-document-age`, still has it
 * silenced when the command runs rather than only when `expandReasons` is asked
 * about it in isolation (R127).
 *
 * Read over `fixtures/multi-repo-asyncapi` as `pnpm fixtures:run` built it,
 * which is how `doctor.test.ts` reads its own fixture.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURE = join(ROOT, 'fixtures', 'multi-repo-asyncapi');
const CONFIG = join(FIXTURE, 'flowatlas.config.json');

const quiet = { out(): void {}, err(): void {}, tty: false };

// Outside the repository on purpose: a configuration left inside `fixtures/`
// by a failed run would be picked up as a fixture of its own.
const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-document-age-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

interface Service {
  repo?: string;
  document?: { kind: string; path: string };
}

/** The fixture's configuration, pointed back at the fixture, with reasons silenced. */
const silencing = (ignoreReasons: string[]): string => {
  const config = JSON.parse(readFileSync(CONFIG, 'utf8')) as {
    services: Service[];
    output: string;
  };
  const services = config.services.map((service) => ({
    ...service,
    ...(service.repo === undefined ? {} : { repo: join(FIXTURE, service.repo) }),
    ...(service.document === undefined
      ? {}
      : { document: { ...service.document, path: join(FIXTURE, service.document.path) } }),
  }));
  const path = join(scratch, `${ignoreReasons.join('+') || 'none'}.config.json`);
  writeFileSync(
    path,
    JSON.stringify({ ...config, services, output: join(FIXTURE, config.output), doctor: { ignoreReasons } }),
  );
  return path;
};

const ageGroup = (config: string) => {
  const { report } = runDoctorCommand({ config, baseline: false }, quiet);
  const groups = report.unresolved.byReason.filter((group) => group.reason === 'document-age');
  expect(groups).toHaveLength(1);
  return { group: groups[0] as (typeof groups)[number], report };
};

describe('the age of a declared document, as doctor reports it', () => {
  it('is one informational row per declared service, naming the kind the configuration gave', () => {
    const { group } = ageGroup(CONFIG);
    expect(group.level).toBe('info');
    expect(group.excluded).toBe(false);
    expect(group.rows.map((row) => [row.service, row.file, row.line, row.symbol])).toEqual([
      ['billing', 'contracts/billing.asyncapi.json', 1, 'billing'],
      ['analytics', 'contracts/analytics.asyncapi.json', 1, 'analytics'],
    ]);
    for (const row of group.rows) {
      // The dates move with every commit, so the sentence is held around them.
      expect(row.message).toMatch(
        new RegExp(
          `^${row.service} was declared by contracts/${row.service}\\.asyncapi\\.json, ` +
            'the asyncapi document last changed \\d{4}-\\d{2}-\\d{2}; ',
        ),
      );
      expect(row.message).not.toContain('OpenAPI');
    }
  });

  it('is silenced by the reason as it is spelled now', () => {
    const { group, report } = ageGroup(silencing(['document-age']));
    expect(group.excluded).toBe(true);
    expect(report.unresolved.excluded.reasons).toContain('document-age');
  });

  it('is still silenced by the spelling a project wrote before the rename', () => {
    const { group, report } = ageGroup(silencing(['openapi-document-age']));
    expect(group.excluded).toBe(true);
    expect(report.unresolved.excluded.reasons).toEqual(
      expect.arrayContaining(['openapi-document-age', 'document-age']),
    );
  });

  it('is not silenced by a reason that merely resembles it', () => {
    const { group } = ageGroup(silencing(['asyncapi-document-age']));
    expect(group.excluded).toBe(false);
  });
});
