import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { catalogProblems, dslProblems } from '@flowatlas/linker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { CliError, EXIT } from '../exit.js';
import { buildProject } from './build.js';
import { runExport } from './export.js';

/**
 * `flowatlas export` (P119) over a copy of the bookshop (`fixtures/multi-repo`
 * with its catalogue variant) and of the lending library
 * (`fixtures/multi-repo-events`), each built in a scratch directory so the
 * exports and the edit that adds a crossing never touch the fixture.
 */
const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXED = '2026-01-01T00:00:00.000Z';
const scratch = mkdtempSync(join(ROOT, 'fixtures', '.scratch-export-'));
const shop = join(scratch, 'multi-repo');
const library = join(scratch, 'multi-repo-events');
const shopConfig = join(shop, 'flowatlas.catalog.json');
const libraryConfig = join(library, 'flowatlas.config.json');
const quiet = { out(): void {}, err(): void {}, tty: false };

beforeAll(async () => {
  for (const [name, dir] of [
    ['multi-repo', shop],
    ['multi-repo-events', library],
  ] as const) {
    cpSync(join(ROOT, 'fixtures', name), dir, { recursive: true, filter: (from) => !from.split(sep).includes('.flowatlas') && !from.split(sep).some((part) => part.startsWith('expected')) });
  }
  await buildProject({ config: shopConfig, builtAt: FIXED });
  await buildProject({ config: libraryConfig, builtAt: FIXED });
}, 300_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

/** Every entity in every YAML file of a Backstage export directory, documents (OpenAPI, AsyncAPI) aside. */
const entitiesIn = (dir: string): unknown[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.yaml') && !/\.(openapi|asyncapi)\.yaml$/.test(name))
    .sort()
    .flatMap((name) => YAML.parseAllDocuments(readFileSync(join(dir, name), 'utf8')).map((document) => document.toJSON()));

describe('flowatlas export backstage (P119)', () => {
  it('writes the entities and the documents their APIs point at, every entity valid and every file the Location lists there', () => {
    const out = join(scratch, 'shop-backstage');
    const run = runExport('backstage', { config: shopConfig, out }, quiet);
    expect(run.exitCode).toBe(EXIT.ok);
    expect(readdirSync(out).sort()).toEqual([
      'billing.openapi.yaml',
      'billing.yaml',
      'catalog-locations.yaml',
      'gateway.openapi.yaml',
      'gateway.yaml',
      'orders.asyncapi.yaml',
      'orders.openapi.yaml',
      'orders.yaml',
      'resources.yaml',
      'web.yaml',
    ]);
    const entities = entitiesIn(out);
    expect(catalogProblems(entities)).toEqual([]);
    // The file is the data: read back, the entities are what was built.
    const byKey = (list: readonly unknown[]) =>
      [...(list as Array<{ kind: string; metadata: { name: string } }>)].sort((a, b) => `${a.kind}:${a.metadata.name}`.localeCompare(`${b.kind}:${b.metadata.name}`));
    expect(byKey(entities)).toEqual(byKey(JSON.parse(JSON.stringify(run.backstage!.entities)) as unknown[]));
    const location = YAML.parse(readFileSync(join(out, 'catalog-locations.yaml'), 'utf8')) as { spec: { targets: string[] } };
    for (const target of location.spec.targets) expect(existsSync(join(out, target))).toBe(true);
    for (const each of entities as Array<{ kind: string; spec: { definition?: { $text?: string } } }>) {
      if (each.kind === 'API' && each.spec.definition?.$text !== undefined) expect(existsSync(join(out, each.spec.definition.$text))).toBe(true);
    }
  });

  it("consumes for web only the gateway's API, and joins orders and billing through order.created", () => {
    const run = runExport('backstage', { config: shopConfig, out: join(scratch, 'shop-joins') }, quiet);
    const component = (name: string) => run.backstage!.entities.find((each) => each.kind === 'Component' && each.metadata.name === name)!;
    expect(component('web').spec['consumesApis']).toEqual(['gateway-openapi']);
    expect(component('web').spec['dependsOn']).toBeUndefined();
    expect(component('billing').spec['consumesApis']).toEqual(['orders-asyncapi']);
    expect(component('orders').spec['providesApis']).toEqual(['orders-asyncapi', 'orders-openapi']);
    expect(component('gateway').spec).toMatchObject({ owner: 'team-storefront', lifecycle: 'production', system: 'bookshop' });
    expect(run.text).toContain('owner not given for 1 service, written as unknown: web');
    expect(run.text).toContain('nothing in the project publishes invoice.requested: billing consumes it from no API');
  });

  it('refuses to write into a configured repository, and --check may read there', () => {
    expect(() => runExport('backstage', { config: shopConfig, out: join(shop, 'gateway', 'catalog') }, quiet)).toThrow(CliError);
    try {
      runExport('backstage', { config: shopConfig, out: join(shop, 'gateway', 'catalog') }, quiet);
    } catch (error) {
      expect((error as CliError).code).toBe(EXIT.cannotRun);
      expect((error as Error).message).toContain('inside the repository of gateway');
    }
    const check = runExport('backstage', { config: shopConfig, out: join(shop, 'gateway', 'catalog'), check: true }, quiet);
    expect(check.exitCode).toBe(EXIT.failed);
    expect(check.files.every((file) => file.state === 'missing')).toBe(true);
    expect(existsSync(join(shop, 'gateway', 'catalog'))).toBe(false);
  });

  it('passes --check when nothing changed, and fails it on an edited, a missing and a stale file, writing nothing', () => {
    const out = join(scratch, 'shop-check');
    runExport('backstage', { config: shopConfig, out }, quiet);
    expect(runExport('backstage', { config: shopConfig, out, check: true }, quiet).exitCode).toBe(EXIT.ok);
    const web = join(out, 'web.yaml');
    writeFileSync(web, readFileSync(web, 'utf8').replace('    - gateway-openapi', '    - orders-openapi'));
    rmSync(join(out, 'resources.yaml'));
    writeFileSync(join(out, 'old-service.yaml'), 'kind: Component\nmetadata:\n  annotations:\n    flowatlas/graph-id: repo:old-service\n');
    // A hand-kept entity beside the export is not flowatlas's to call stale.
    writeFileSync(join(out, 'team.yaml'), 'kind: Group\n');
    const run = runExport('backstage', { config: shopConfig, out, check: true }, quiet);
    expect(run.exitCode).toBe(EXIT.failed);
    expect(run.files.filter((file) => file.state !== 'same').map((file) => `${file.path} ${file.state}`)).toEqual(['resources.yaml missing', 'web.yaml differs', 'old-service.yaml stale']);
    expect(run.text).toContain('  + web spec.consumesApis: - gateway-openapi');
    expect(run.text).toContain('  - web spec.consumesApis: - orders-openapi');
    expect(existsSync(join(out, 'resources.yaml'))).toBe(false);
  });

  it('prints the entities as data with --json', () => {
    const run = runExport('backstage', { config: shopConfig, out: join(scratch, 'shop-json'), json: true }, quiet);
    const said = JSON.parse(run.text) as { kind: string; entities: unknown[]; summary: { components: number } };
    expect(said.kind).toBe('backstage');
    expect(said.summary.components).toBe(4);
    expect(catalogProblems(said.entities)).toEqual([]);
  });

  it('writes the lending library: functions, channels and a heuristic delivery only when asked, every entity valid', () => {
    const plain = runExport('backstage', { config: libraryConfig, out: join(scratch, 'library-backstage') }, quiet);
    expect(catalogProblems(entitiesIn(join(scratch, 'library-backstage')))).toEqual([]);
    const component = (run: typeof plain, name: string) => run.backstage!.entities.find((each) => each.kind === 'Component' && each.metadata.name === name)!;
    expect(component(plain, 'notifications').spec).toMatchObject({ type: 'function', consumesApis: ['routing-asyncapi'] });
    expect(component(plain, 'routing').spec['dependsOn']).toEqual(['component:notifications']);
    expect(component(plain, 'platform-events').spec['consumesApis']).toBeUndefined();
    const asked = runExport('backstage', { config: libraryConfig, out: join(scratch, 'library-heuristic'), includeHeuristic: true }, quiet);
    // Matched by a pattern only: drawn when asked, and named as such.
    expect(component(asked, 'platform-events').spec['consumesApis']).toEqual(['loans-asyncapi']);
    expect(component(asked, 'platform-events').metadata.annotations?.['flowatlas/heuristic-relations']).toBe('api:loans-asyncapi');
  });
});

describe('flowatlas export structurizr (P119)', () => {
  it('writes a workspace that holds to the DSL, with a dynamic view per flow in call order', () => {
    const out = join(scratch, 'shop-structurizr');
    const run = runExport('structurizr', { config: shopConfig, out }, quiet);
    expect(run.exitCode).toBe(EXIT.ok);
    const text = readFileSync(join(out, 'workspace.dsl'), 'utf8');
    expect(dslProblems(text)).toEqual([]);
    const post = run.structurizr!.model.views.find((view) => view.entry === 'entry:orders:http:POST:/orders')!;
    expect(post.steps.map((step) => `${step.from} -> ${step.to}`)).toEqual(['orders -> orders_store', 'orders -> order_messages', 'order_messages -> billing']);
  });

  it('draws only the flows named with --flow, and bounds the rest with --max-flows', () => {
    const named = runExport('structurizr', { config: shopConfig, out: join(scratch, 'shop-named'), flow: ['POST /orders'] }, quiet);
    expect(named.structurizr!.model.views.map((view) => view.entry)).toEqual(['entry:orders:http:POST:/orders']);
    const bounded = runExport('structurizr', { config: shopConfig, out: join(scratch, 'shop-bounded'), maxFlows: '2' }, quiet);
    expect(bounded.structurizr!.model.views).toHaveLength(2);
    expect(bounded.text).toMatch(/\d+ more flows? crossed containers, past --max-flows 2/);
  });
});

describe('export --check after a new crossing (P119 acceptance)', () => {
  it('fails, naming the relation, once the gateway takes a channel orders publishes', async () => {
    const backstageOut = join(scratch, 'crossing-backstage');
    const structurizrOut = join(scratch, 'crossing-structurizr');
    runExport('backstage', { config: shopConfig, out: backstageOut }, quiet);
    runExport('structurizr', { config: shopConfig, out: structurizrOut }, quiet);

    // The new cross-service crossing: the gateway handles order.archived, which orders publishes.
    const consumer = join(shop, 'gateway', 'src', 'orders', 'archived.consumer.ts');
    writeFileSync(
      consumer,
      [
        "import { Controller } from '@nestjs/common';",
        "import { EventPattern, Payload } from '@nestjs/microservices';",
        '',
        '@Controller()',
        'export class ArchivedConsumer {',
        "  @EventPattern('order.archived')",
        '  onArchived(@Payload() event: { orderId: string }): string {',
        '    return event.orderId;',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    const manifest = join(shop, 'gateway', 'package.json');
    const declared = readFileSync(manifest, 'utf8');
    writeFileSync(manifest, declared.replace('"@nestjs/core": "^11.0.0",', '"@nestjs/core": "^11.0.0",\n    "@nestjs/microservices": "^11.0.0",'));
    const module = join(shop, 'gateway', 'src', 'app.module.ts');
    const before = readFileSync(module, 'utf8');
    writeFileSync(
      module,
      before
        .replace("import { OrdersController } from './orders/orders.controller';", "import { ArchivedConsumer } from './orders/archived.consumer';\nimport { OrdersController } from './orders/orders.controller';")
        .replace('controllers: [OrdersController]', 'controllers: [OrdersController, ArchivedConsumer]'),
    );
    try {
      await buildProject({ config: shopConfig, builtAt: FIXED });
      const backstage = runExport('backstage', { config: shopConfig, out: backstageOut, check: true }, quiet);
      expect(backstage.exitCode).toBe(EXIT.failed);
      // The AsyncAPI document orders publishes now names the gateway among its consumers too.
      expect(backstage.files.filter((file) => file.state !== 'same').map((file) => file.path)).toEqual(['gateway.yaml', 'orders.asyncapi.yaml']);
      expect(backstage.text).toContain('  + gateway spec.consumesApis: - orders-asyncapi');
      const structurizr = runExport('structurizr', { config: shopConfig, out: structurizrOut, check: true }, quiet);
      expect(structurizr.exitCode).toBe(EXIT.failed);
      expect(structurizr.text).toContain('  + order_messages -> gateway "delivers order.archived" "Messaging"');
    } finally {
      rmSync(consumer);
      writeFileSync(module, before);
      writeFileSync(manifest, declared);
      await buildProject({ config: shopConfig, builtAt: FIXED });
    }
  }, 300_000);
});
