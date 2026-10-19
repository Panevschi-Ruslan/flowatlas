import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseSpecAgainst } from '@flowatlas/linker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT } from '../exit.js';
import { sarifProblems } from '../sarif/schema-check.js';
import type { SarifLog } from '../sarif/types.js';
import { buildProject } from './build.js';
import { runContracts } from './contracts.js';
import { runSpecAgainst, type SpecAgainstOptions } from './spec-against.js';

/**
 * A committed OpenAPI document against the code (P195), over
 * `fixtures/nest-committed-openapi`: `shop/openapi.yaml` still lists
 * `DELETE /products/{productId}`, which the controller no longer has, and
 * says nothing of `GET /products/:id/reviews`, which it gained. Everything
 * else in it - a query value, a `201`, other names for the components and
 * the path's parameter - agrees with the code.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURE = join(ROOT, 'fixtures', 'nest-committed-openapi');
const config = join(FIXTURE, 'flowatlas.config.json');
const quiet = { out(): void {}, err(): void {}, tty: false };

let out: string;
const against = (options: Partial<SpecAgainstOptions>) => runSpecAgainst({ config, out, ...options }, quiet);

beforeAll(async () => {
  out = mkdtempSync(join(ROOT, 'fixtures', '.scratch-against-'));
  await buildProject({ config });
}, 120_000);

afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('flowatlas spec --against (P195)', () => {
  it('names the route the document declares and the code does not answer, at the document\'s line, and the one it leaves out - nothing else', () => {
    const run = against({ against: ['shop'] });
    expect(run.report.changes.map((change) => `${change.level} ${change.kind} ${change.operation}`)).toEqual([
      'error method-removed DELETE /products/{productId}',
      'info endpoint-added GET /products/{id}/reviews',
    ]);
    const [removed, added] = run.report.changes;
    const line = readFileSync(join(FIXTURE, 'shop', 'openapi.yaml'), 'utf8').split('\n').findIndex((text) => text.trim() === 'delete:') + 1;
    expect(removed?.place).toEqual({ side: 'base', file: 'openapi.yaml', line });
    expect(added?.place).toMatchObject({ side: 'head', file: 'src/products/products.controller.ts' });
    expect(run.exitCode).toBe(EXIT.failed);
    expect(run.report.documents).toEqual([{ service: 'shop', kind: 'openapi', file: 'openapi.yaml', declared: 4, written: 4 }]);
    expect(parseSpecAgainst(JSON.parse(readFileSync(run.file, 'utf8')))).toEqual(run.report);
  });

  it('reads an optional query value as optional, as the document declares it (P197)', () => {
    const run = against({ against: ['shop'] });
    expect(run.report.changes.some((change) => change.field === 'query.page')).toBe(false);
  });

  it('takes a file named on the command line, fails only at the level asked, and writes a SARIF log that validates', () => {
    const file = join(out, 'agrees.json');
    const document = JSON.parse(JSON.stringify({ openapi: '3.1.0', info: { title: 'shop', version: '1' }, paths: {} }));
    writeFileSync(file, JSON.stringify(document));
    const empty = against({ against: [`shop=${file}`], failOn: 'none' });
    expect(empty.exitCode).toBe(EXIT.ok);
    expect(empty.report.changes.every((change) => change.kind === 'endpoint-added')).toBe(true);
    const sarif = against({ against: ['shop'], format: 'sarif' });
    const log = JSON.parse(sarif.text) as SarifLog;
    expect(sarifProblems(log)).toEqual([]);
    expect(log.runs[0]?.results.map((result) => result.ruleId)).toEqual(['spec/method-removed', 'spec/endpoint-added']);
  });

  it('refuses what it cannot compare, by name', () => {
    expect(() => against({ against: ['nobody=x.yaml'] })).toThrow(/no service named "nobody"/);
    expect(() => against({ against: [`shop=${join(out, 'missing.yaml')}`] })).toThrow(/no document at/);
    const neither = join(out, 'neither.json');
    writeFileSync(neither, '{"swagger": "2.0"}');
    expect(() => against({ against: [`shop=${neither}`] })).toThrow(/neither openapi nor asyncapi/);
  });

  it('is a section of contracts for every document the configuration lists, failing it at --fail-on', () => {
    const run = runContracts({ config, out, failOn: 'error' }, quiet);
    expect(run.documents?.changes.map((change) => change.kind)).toEqual(['method-removed', 'endpoint-added']);
    expect(run.text).toContain('spec against the code');
    expect(run.exitCode).toBe(EXIT.failed);
    expect(runContracts({ config, out }, quiet).exitCode).toBe(EXIT.ok);
  });
});
