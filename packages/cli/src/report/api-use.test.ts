import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseSpecDiff, type SpecChange, type SpecDiffReport } from '@flowatlas/linker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT } from '../exit.js';
import { runDiff } from '../commands/diff.js';
import { runSpecDiff } from '../commands/spec.js';
import { literalChange, literalsOf } from './api-use.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURES = join(ROOT, 'fixtures');
const FIXTURE = join(FIXTURES, 'api-change-verdicts');
const FIXED = '2026-01-01T00:00:00.000Z';

describe('a type change between literal values (P390)', () => {
  it('reads a choice of literals, and nothing else', () => {
    expect(literalsOf("'post' | 'courier'")).toEqual(new Set(["'post'", "'courier'"]));
    expect(literalsOf('1 | 2')).toEqual(new Set(['1', '2']));
    expect(literalsOf('string')).toBeUndefined();
    expect(literalsOf("'post' | string")).toBeUndefined();
    expect(literalsOf(null)).toBeUndefined();
  });

  it('says a value added is a widening, a value taken away a narrowing, and both neither', () => {
    expect(literalChange("'a' | 'b'", "'a' | 'b' | 'c'")).toEqual({ how: 'widened', values: ["'c'"] });
    expect(literalChange("'a' | 'b'", "'a'")).toEqual({ how: 'narrowed', values: ["'b'"] });
    expect(literalChange("'a' | 'b'", "'a' | 'c'")).toBeUndefined();
    expect(literalChange('string', "'a'")).toBeUndefined();
  });
});

// Beside the fixtures, so the copy still resolves the type stubs hoisted there.
const scratch = mkdtempSync(join(FIXTURES, '.scratch-api-use-'));
const project = join(scratch, 'project');
const config = join(project, 'flowatlas.config.json');
const quiet = { out(): void {}, err(): void {}, tty: false };
const git = (repo: string, ...args: string[]): void => {
  execFileSync('git', ['-C', join(project, repo), '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args]);
};

let report: SpecDiffReport;
const change = (operation: string, field: string | null): SpecChange => {
  const found = report.changes.find((each) => each.operation === operation && each.field === field);
  if (found === undefined) throw new Error(`no change of ${operation} ${field ?? ''}`);
  return found;
};

beforeAll(async () => {
  cpSync(join(FIXTURE, 'base'), project, { recursive: true });
  writeFileSync(
    config,
    JSON.stringify({
      services: [
        { name: 'catalog', repo: './catalog', type: 'nestjs', baseUrlEnv: ['CATALOG_URL'] },
        { name: 'storefront', repo: './storefront', type: 'nestjs' },
        { name: 'notifier', repo: './notifier', type: 'nestjs' },
        { name: 'dashboard', repo: './dashboard', type: 'react', apiBaseEnv: ['VITE_CATALOG_URL'], apiTarget: { VITE_CATALOG_URL: 'catalog' } },
      ],
      adapters: {
        broker: {
          custom: [
            {
              name: 'event-bus',
              channelKind: 'channel',
              producers: [{ receiverType: ['EventBus'], method: 'publish', channelArg: 0, payloadArg: 1, kind: 'event' }],
            },
          ],
        },
      },
      output: '.flowatlas',
    }),
  );
  for (const repo of ['catalog', 'storefront', 'notifier', 'dashboard']) {
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
  }
  cpSync(join(FIXTURE, 'head'), project, { recursive: true });
  git('catalog', 'add', '-A');
  git('catalog', 'commit', '-q', '-m', 'head');
  report = (await runSpecDiff('HEAD~1', undefined, { config, service: ['catalog'] }, quiet)).report;
}, 300_000);

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

describe('what an API change does to the code that uses it (P390)', () => {
  it('is an error where a joined consumer reads the removed field, omits one now required or calls a route that is gone', () => {
    const label = change('send item.changed', 'payload.label');
    expect(label).toMatchObject({ level: 'error', use: { direction: 'breaking', verdict: '1 of 1 consumer: reads `label`, line 16' } });
    expect(label.use?.readers[0]).toMatchObject({ how: 'reads', service: 'notifier', file: 'src/notify.service.ts', line: 16 });
    expect(change('POST /items', 'body.currency')).toMatchObject({ level: 'error', use: { verdict: '1 of 1 caller: sends name, price; no `currency`' } });
    expect(change('DELETE /items/{id}', null)).toMatchObject({ level: 'error', use: { verdict: '1 of 1 caller: requests it' } });
  });

  it('is an info where no consumer reads it or every caller sends it, among the ones counted - the decoys', () => {
    expect(change('send item.changed', 'payload.legacyCode')).toMatchObject({ level: 'info', use: { verdict: 'no consumer reads `legacyCode`, among 1' } });
    expect(change('POST /drafts', 'body.title')).toMatchObject({ level: 'info', use: { verdict: 'every caller sends `title`, among 1' } });
    expect(change('GET /items/{id}/archive', 'response.reason')).toMatchObject({ level: 'info', use: { among: 0 } });
  });

  it('weighs a response field by what each client reads of the answer (P393)', () => {
    // The dashboard's page reads the price: an error placed on the reading code; the storefront's request is not followed.
    const price = change('GET /items/{id}', 'response.price');
    expect(price).toMatchObject({ level: 'error', use: { verdict: '1 of 2 callers: reads `price` in ItemPage, line 13' } });
    expect(price.use?.readers[0]).toMatchObject({ how: 'reads', service: 'dashboard', file: 'src/ItemPage.tsx', line: 13, level: 'error' });
    expect(price.use?.readers[1]).toMatchObject({ how: 'unknown', service: 'storefront', level: 'warning' });
    // Every caller of the list is read and none reads the thumbnail of a row: info.
    expect(change('GET /items', 'response[].thumbnail')).toMatchObject({ level: 'info', use: { verdict: 'no caller reads `thumbnail`, among 1' } });
  });

  it('is a warning where the value reaches a consumer whole, or what it reads of an answer is not read: said, never guessed', () => {
    const warehouse = change('send stock.changed', 'payload.warehouse');
    expect(warehouse).toMatchObject({ level: 'warning', use: { readers: [{ how: 'opaque', said: expect.stringContaining('spread into another value') }] } });
    // Only a server's request calls POST /items: no front-end reader followed its answer.
    const price = change('POST /items', 'response.price');
    expect(price).toMatchObject({ level: 'warning', use: { readers: [{ how: 'unknown', said: expect.stringContaining('its client reads was not read') }] } });
  });

  it('says how much it could see, and in which order to deploy a message change', () => {
    expect(report.coverage).toEqual({ consumers: 8, repositories: 4, said: '8 consumers in 4 repositories; consumers outside them unknown' });
    expect(change('send item.changed', 'payload.label').use?.deployOrder).toEqual({ first: 'consumers', said: 'consumers first: stop reading `label` (or cope without it), then catalog' });
    expect(change('POST /items', 'body.currency').use?.deployOrder?.first).toBe('callers');
    // Nobody meets an info change, so its order does not matter.
    expect(change('send item.changed', 'payload.legacyCode').use?.deployOrder).toBeUndefined();
  });

  it('draws the flow from a way in in one repository to the consumer in another', () => {
    const flow = change('send item.changed', 'payload.label').use?.flows[0] ?? [];
    expect(flow.map((step) => `${step.step} ${step.label}`)).toEqual([
      'way in POST /shop/items',
      'handler ShopController.add',
      'code CatalogClient.createItem',
      'request POST /items',
      'route POST /items',
      'handler ItemsController.create',
      'code ItemsService.create',
      'publish event item.changed',
      'channel item.changed',
      'consumer NotifyService.onItemChanged',
      'handler NotifyService.onItemChanged',
    ]);
    expect(new Set(flow.map((step) => step.service))).toEqual(new Set(['storefront', 'catalog', 'notifier']));
  });

  it('places a route that went on the nearest line of its file that is still there, and one that stayed on its own line', () => {
    expect(change('DELETE /items/{id}', null).use?.anchor).toEqual({ how: 'nearest', file: 'src/items/items.controller.ts', line: 19, from: { file: 'src/items/items.controller.ts', line: 19 } });
    expect(change('POST /items', 'body.currency').use?.anchor).toEqual({ how: 'same', file: 'src/items/items.controller.ts', line: 9 });
  });

  it('writes a report that reads back, and fails diff --fail-on-api-break only on the errors from use', async () => {
    expect(parseSpecDiff(JSON.parse(JSON.stringify(report)))).toEqual(report);
    const said: string[] = [];
    const run = await runDiff('HEAD~1', undefined, { config, service: ['catalog'], generatedAt: FIXED, failOnApiBreak: true }, { out() {}, err: (text) => said.push(text), tty: false });
    expect(run.exitCode).toBe(EXIT.failed);
    expect(run.failedOn).toContain('api');
    expect(said.filter((line) => line.startsWith('api break: '))).toHaveLength(4);
  });

  it('writes each flow as a code flow across repositories and the consumers as related locations in SARIF', async () => {
    let text = '';
    await runSpecDiff('HEAD~1', undefined, { config, service: ['catalog'], format: 'sarif' }, { out: (more) => (text += more), err() {}, tty: false });
    const run = JSON.parse(text).runs[0];
    const label = run.results.find((result: { message: { text: string } }) => result.message.text.startsWith('send item.changed: base had `payload.label`'));
    expect(label.level).toBe('error');
    expect(label.relatedLocations[0].physicalLocation.artifactLocation.uri).toBe('notifier/src/notify.service.ts');
    expect(label.codeFlows[0].threadFlows[0].locations.map((step: { location: { physicalLocation: { artifactLocation: { uri: string } } } }) => step.location.physicalLocation.artifactLocation.uri.split('/')[0])).toEqual([
      'storefront', 'storefront', 'storefront', 'storefront', 'catalog', 'catalog', 'catalog', 'catalog', 'catalog', 'notifier', 'notifier',
    ]);
    expect(run.invocations[0].toolExecutionNotifications[0].message.text).toBe('8 consumers in 4 repositories; consumers outside them unknown');
  });
});
