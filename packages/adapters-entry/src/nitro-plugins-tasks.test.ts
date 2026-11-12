import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GraphBuilder, noAdapters, parseConfig, silentLogger, type EntryNode, type ExtractContext, type Unresolved } from '@flowatlas/core';
import { Project } from 'ts-morph';
import { afterAll, describe, expect, it } from 'vitest';
import { nitroRoutesAdapter } from './nuxt-routes.js';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A Nitro server: its configuration on disk, its sources in the checker's project. */
const extract = (files: Record<string, string>, config?: string, pkg: ExtractContext['pkg'] = { dependencies: { nitropack: '^2.10.0' } }): { entries: EntryNode[]; unresolved: Unresolved[] } => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-nitro-')));
  roots.push(root);
  if (config !== undefined) writeFileSync(join(root, 'nitro.config.ts'), config);
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: false } });
  for (const [path, source] of Object.entries(files)) project.createSourceFile(join(root, path), source);
  const ctx: ExtractContext = {
    repo: 'api',
    repoDir: root,
    service: { name: 'api', repo: root, type: 'node' },
    config: parseConfig({}),
    pkg,
    project,
    checker: project.getTypeChecker(),
    builder: new GraphBuilder({ repo: 'api' }),
    adapters: noAdapters,
    logger: silentLogger,
  };
  const entries = nitroRoutesAdapter.extractEntries(ctx);
  return { entries, unresolved: ctx.builder.build().unresolved };
};

const HANDLER = 'export default defineEventHandler(() => 1);';

describe("Nitro's plugins and tasks (P258)", () => {
  it("puts each plugin's `request` hooks in front of every route, before its middleware, and its response hooks behind", () => {
    const { entries } = extract({
      'server/api/orders.get.ts': HANDLER,
      'server/middleware/auth.ts': HANDLER,
      'server/plugins/b-timing.ts': "export default defineNitroPlugin((app) => { app.hooks.hook('afterResponse', () => undefined); app.hooks.hook('close', () => undefined); });",
      'server/plugins/a-log.ts': "export default defineNitroPlugin((nitroApp) => { nitroApp.hooks.hook('request', (event) => undefined); });",
      'server/plugins/nested/skip.ts': "export default defineNitroPlugin((nitroApp) => { nitroApp.hooks.hook('request', () => undefined); });",
    });
    const route = entries.find((entry) => entry.label === 'GET /api/orders');
    expect(route?.wrapping?.map((one) => [one.label, one.layer, one.source])).toEqual([
      ['a-log request', 'middleware', 'server/plugins'],
      ['auth', 'middleware', 'server/middleware'],
      ['b-timing afterResponse', 'interceptor', 'server/plugins'],
    ]);
  });

  it('reads each file of `tasks/` as a task named by its path, its handler the `run` it defines, and says one that defines none', () => {
    const { entries, unresolved } = extract({
      'server/tasks/db/migrate.ts': "export default defineTask({ meta: { description: 'x' }, run({ payload }) { return { result: payload }; } });",
      'server/tasks/report.ts': 'export default defineTask({ meta: {}, run: async () => ({ result: 1 }) });',
      'server/tasks/broken.ts': 'export default somethingElse;',
    });
    const tasks = entries.filter((entry) => entry.kind === 'task');
    expect(tasks.map((entry) => [entry.id, entry.key, entry.handler === undefined ? null : entry.handler.line]).sort()).toEqual([
      ['entry:api:task:broken', 'broken', null],
      ['entry:api:task:db:migrate', 'db:migrate', 1],
      ['entry:api:task:report', 'report', 1],
    ]);
    expect(unresolved.filter((row) => row.reason === 'fs-route-handler-not-read').map((row) => row.symbol)).toEqual(['task broken']);
  });

  it('reads `scheduledTasks` as a schedule of its own that reaches each task it lists, and says one written as code', () => {
    const { entries } = extract({ 'server/tasks/db/migrate.ts': 'export default defineTask({ run() { return {}; } });' }, "export default defineNitroConfig({ scheduledTasks: { '0 * * * *': ['db:migrate'], '*/5 * * * *': 'report' } });");
    expect(entries.filter((entry) => entry.kind === 'cron').map((entry) => [entry.label, entry.meta?.['reaches']])).toEqual([
      ['cron 0 * * * *', ['task:db:migrate']],
      ['cron */5 * * * *', ['task:report']],
    ]);
    const coded = extract({}, 'export default defineNitroConfig({ scheduledTasks: schedule });');
    expect(coded.entries).toEqual([]);
    expect(coded.unresolved.map((row) => [row.reason, row.symbol])).toEqual([['framework-setting-dynamic', 'scheduledTasks']]);
  });
});

describe("whether Nitro builds its tasks (P262)", () => {
  const TASK = { 'server/tasks/db/migrate.ts': 'export default defineTask({ run() { return {}; } });' };
  const flagged = (entries: readonly EntryNode[]) => entries.map((entry) => [entry.label, entry.meta?.['enabled'] ?? null]);

  it('marks every task and schedule not enabled, and says so once, where `experimental.tasks` is not on', () => {
    const off = extract(TASK, "export default defineNitroConfig({ scheduledTasks: { '0 * * * *': ['db:migrate'] } });");
    expect(flagged(off.entries)).toEqual([
      ['task db:migrate', false],
      ['cron 0 * * * *', false],
    ]);
    expect(off.unresolved.filter((row) => row.reason === 'framework-feature-off').map((row) => [row.file, row.symbol, row.meta?.['tasks']])).toEqual([
      ['nitro.config.ts', 'experimental.tasks', ['db:migrate']],
    ]);
    // No configuration at all: the flag is off as Nitro's default, said at the manifest.
    expect(extract(TASK).unresolved.find((row) => row.reason === 'framework-feature-off')?.file).toBe('package.json');
  });

  it('leaves them as they are where the flag is on, and says a flag written as code', () => {
    const on = extract(TASK, 'export default defineNitroConfig({ experimental: { tasks: true } });');
    expect(flagged(on.entries)).toEqual([['task db:migrate', null]]);
    expect(on.unresolved.filter((row) => row.reason === 'framework-feature-off')).toEqual([]);
    const coded = extract(TASK, 'export default defineNitroConfig({ experimental: { tasks: process.env.TASKS === "1" } });');
    expect(flagged(coded.entries)).toEqual([['task db:migrate', null]]);
    expect(coded.unresolved.map((row) => [row.reason, row.symbol])).toEqual([['framework-setting-dynamic', 'experimental.tasks']]);
  });

  it('needs no flag on Nitro 3', () => {
    const graph = extract(TASK, undefined, { dependencies: { nitro: '^3.0.0' } });
    expect(flagged(graph.entries)).toEqual([['task db:migrate', null]]);
    expect(graph.unresolved.filter((row) => row.reason === 'framework-feature-off')).toEqual([]);
  });
});
