import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { CliError, EXIT } from '../exit.js';
import { specProblems } from '../report/spec-schema-check.js';
import { buildProject } from './build.js';
import { runSpec } from './spec.js';

/**
 * `flowatlas spec` (P118) over the bookshop whose services disagree on
 * purpose (`fixtures/multi-repo-contracts`) and the lending library whose
 * events arrive wrapped (`fixtures/multi-repo-events`), each copied and built
 * so the documents are written beside a copy and never into the fixture.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXED = '2026-01-01T00:00:00.000Z';
const scratch = mkdtempSync(join(ROOT, 'fixtures', '.scratch-spec-'));
const shop = join(scratch, 'multi-repo-contracts');
const library = join(scratch, 'multi-repo-events');
const shopConfig = join(shop, 'flowatlas.config.json');
const libraryConfig = join(library, 'flowatlas.config.json');
const quiet = { out(): void {}, err(): void {}, tty: false };

beforeAll(async () => {
  for (const [name, dir] of [
    ['multi-repo-contracts', shop],
    ['multi-repo-events', library],
  ] as const) {
    cpSync(join(ROOT, 'fixtures', name), dir, { recursive: true, filter: (from) => !from.split(sep).includes('.flowatlas') && !from.split(sep).includes('expected.cli') });
  }
  await buildProject({ config: shopConfig, builtAt: FIXED });
  await buildProject({ config: libraryConfig, builtAt: FIXED });
}, 300_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

describe('flowatlas spec (P118)', () => {
  it('writes each service\'s documents into the output, each valid against its official schema and read back', () => {
    const out = join(scratch, 'shop-spec');
    const run = runSpec({ config: shopConfig, out }, quiet);
    expect(run.exitCode).toBe(EXIT.ok);
    expect(run.problems).toEqual([]);
    expect(readdirSync(out).sort()).toEqual(['billing.asyncapi.yaml', 'orders.asyncapi.yaml', 'orders.openapi.yaml']);
    for (const spec of run.specs) {
      expect(specProblems(spec.document), spec.name).toEqual([]);
      // The file is the document: read back, it is the same data.
      expect(YAML.parse(readFileSync(join(out, `${spec.name}.${spec.kind}.yaml`), 'utf8'))).toEqual(spec.document);
    }
    expect(run.text).toContain('openapi orders: 15 operations · not read: any-typed 1, transformed 1');
  });

  it('writes the wire pair as JSON delivers it, so the document and contracts agree (D1)', () => {
    const run = runSpec({ config: shopConfig, out: join(scratch, 'shop-wire') }, quiet);
    const orders = run.specs.find((spec) => spec.kind === 'openapi')!.document as { components: { schemas: Record<string, { properties: Record<string, unknown> }> } };
    const wire = orders.components.schemas['WireDto']!.properties;
    expect(wire['placedAt']).toEqual({ type: 'string' });
    expect(wire['customer_id']).toBeDefined();
    // orders' own annotations, on the side that reads the request: renamed, dropped, taken over.
    expect(wire['shipping_city']).toEqual({ type: 'string' });
    expect(wire['internalNote']).toBeUndefined();
    expect(wire['score']).toEqual({ 'x-flowatlas-unread': 'transformed' });
  });

  it('writes a delivery\'s wrapping beside the message it carries, and every document validates', () => {
    const run = runSpec({ config: libraryConfig, out: join(scratch, 'library-spec') }, quiet);
    expect(run.problems).toEqual([]);
    for (const spec of run.specs) expect(specProblems(spec.document), spec.name).toEqual([]);
    const notifications = run.specs.find((spec) => spec.name === 'notifications' && spec.kind === 'asyncapi')!;
    const [operation] = Object.values(notifications.document['operations'] as Record<string, Record<string, unknown>>);
    expect(operation!['x-flowatlas-envelope']).toEqual({ path: 'Records[].body', text: true });
  });

  it('fails --check when a written document is out of date, and writes nothing', () => {
    const out = join(scratch, 'shop-check');
    runSpec({ config: shopConfig, out }, quiet);
    expect(runSpec({ config: shopConfig, out, check: true }, quiet).exitCode).toBe(EXIT.ok);
    const file = join(out, 'orders.openapi.yaml');
    writeFileSync(file, readFileSync(file, 'utf8').replace('title: orders', 'title: orders (edited)'));
    rmSync(join(out, 'billing.asyncapi.yaml'));
    writeFileSync(join(out, 'payments.openapi.yaml'), 'openapi: 3.1.0\n');
    writeFileSync(join(out, 'billing@admin.openapi.yaml'), 'openapi: 3.1.0\n');
    const run = runSpec({ config: shopConfig, out, check: true }, quiet);
    expect(run.exitCode).toBe(EXIT.failed);
    expect(run.files.map((each) => `${each.file.slice(out.length + 1)} ${each.state}`)).toEqual([
      'billing.asyncapi.yaml missing',
      'orders.asyncapi.yaml same',
      'orders.openapi.yaml differs',
      'billing@admin.openapi.yaml stale',
    ]);
    // Nothing was written over the edited file or in place of the missing one.
    expect(readFileSync(file, 'utf8')).toContain('title: orders (edited)');
    expect(readdirSync(out)).not.toContain('billing.asyncapi.yaml');
  });

  it('writes the inventory of every route with its guards, callers, tables, channels and fails', () => {
    const out = join(scratch, 'shop-inventory');
    const run = runSpec({ config: shopConfig, out, inventory: true, kind: 'openapi' }, quiet);
    const table = readFileSync(join(out, 'inventory.md'), 'utf8');
    expect(table).toContain('15 routes, 1 procedure, read from the code');
    expect(table).toContain('| `orders` | POST | `/orders` | no | — | gateway 1, web 1 | — | `order.created` | — | `src/orders/orders.controller.ts:13` |');
    expect(table).toContain('| `orders` | POST | `/orders/drafts/store` | yes | — | gateway 1 | `drafts` | — | 400 |');
    expect(run.inventory?.length).toBe(16);
    expect(readdirSync(out).sort()).toEqual(['inventory.md', 'orders.openapi.yaml']);
    const json = runSpec({ config: shopConfig, out: join(scratch, 'shop-inventory-json'), inventory: true, format: 'json' }, quiet);
    expect(JSON.parse(readFileSync(join(scratch, 'shop-inventory-json', 'inventory.json'), 'utf8')).routes).toHaveLength(16);
    expect(json.files.map((each) => each.file.slice(each.file.lastIndexOf(sep) + 1))).toContain('orders.openapi.json');
  });

  it('refuses to write into a repository it reads, and a service it does not know', () => {
    expect(() => runSpec({ config: shopConfig, out: join(shop, 'orders', 'docs') }, quiet)).toThrow(CliError);
    try {
      runSpec({ config: shopConfig, out: join(shop, 'orders', 'docs') }, quiet);
    } catch (error) {
      expect((error as CliError).code).toBe(EXIT.cannotRun);
      expect((error as Error).message).toMatch(/inside the repository of orders/);
    }
    expect(() => runSpec({ config: shopConfig, service: ['payments'] }, quiet)).toThrow(/no service named "payments"/);
    // --check writes nothing, so it may read a document a repository commits.
    expect(runSpec({ config: shopConfig, out: join(shop, 'orders', 'docs'), check: true }, quiet).exitCode).toBe(EXIT.failed);
  });
});
