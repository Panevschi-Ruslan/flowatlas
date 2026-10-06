import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  emptyCache,
  hashFile,
  type BuildCache,
  type DependencyState,
  type FileStamp,
  type RepoCache,
} from './cache.js';
import { hashGraphFile, planRebuild, type RepoSurvey } from './incremental.js';

const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-plan-'));

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

/** A repository graph as the builder writes one, timestamp and all. */
const graphFile = (name: string, generatedAt: string, nodes: unknown[] = [], indent = 2): string => {
  const path = join(scratch, name);
  const graph = {
    schemaVersion: 2,
    generatedAt,
    repo: 'orders',
    nodes,
    edges: [],
    types: {},
    unresolved: [],
  };
  writeFileSync(path, JSON.stringify(graph, null, indent));
  return path;
};

const NESTJS = '@flowatlas/extractor-nestjs';

const stamp = (hash: string, deps: string[] = []): FileStamp => ({
  hash,
  size: hash.length,
  mtimeMs: 0,
  deps,
});

/** Four files: a module, an entry file, a service and the controller calling it. */
const files = (): Record<string, FileStamp> => ({
  'src/main.ts': stamp('sha1:main'),
  'src/orders/orders.module.ts': stamp('sha1:module', ['src/orders/orders.service.ts']),
  'src/orders/orders.service.ts': stamp('sha1:service'),
  'src/orders/orders.controller.ts': stamp('sha1:controller', ['src/orders/orders.service.ts']),
});

/** A repository last read with its dependencies present, which is the ordinary case. */
const installed = (): DependencyState => ({
  installed: ['.'],
  lockfiles: { 'pnpm-lock.yaml': 'sha1:lock' },
});

const entry = (over: Partial<RepoCache> = {}): RepoCache => ({
  repo: '../orders',
  extractor: NESTJS,
  adapters: ['nestjs-http'],
  tsconfigHash: 'sha1:ts',
  packageJsonHash: 'sha1:pkg',
  dependencies: installed(),
  globalFiles: ['src/main.ts', 'src/orders/orders.module.ts'],
  files: files(),
  graphPath: '.flowatlas/services/orders/graph.json',
  graphHash: 'sha1:graph',
  counts: { nodes: 0, edges: 0, types: 0, unresolved: 0 },
  ...over,
});

const survey = (over: Partial<RepoSurvey> = {}): RepoSurvey => ({
  service: 'orders',
  repo: '../orders',
  extractor: NESTJS,
  incremental: true,
  adapters: ['nestjs-http'],
  tsconfigHash: 'sha1:ts',
  packageJsonHash: 'sha1:pkg',
  dependencies: installed(),
  globalFiles: ['src/main.ts', 'src/orders/orders.module.ts'],
  files: files(),
  graphPath: '.flowatlas/services/orders/graph.json',
  graphHash: 'sha1:graph',
  ...over,
});

const cacheOf = (...entries: Array<[string, RepoCache]>): BuildCache => ({
  ...emptyCache(
    { schemaVersion: 2, flowatlasVersion: '0.0.0', extractors: {}, configHash: 'sha1:config' },
    '2026-01-01T00:00:00.000Z',
  ),
  repos: Object.fromEntries(entries),
});

const changed = (file: string, over: Partial<RepoSurvey> = {}): RepoSurvey => {
  const next = files();
  next[file] = stamp(`sha1:${file}-edited`, next[file]?.deps ?? []);
  return survey({ files: next, ...over });
};

describe('planning what to re-read', () => {
  it('reads a repository the cache has never seen', () => {
    expect(planRebuild([survey()], { cache: cacheOf() })).toEqual({
      orders: { mode: 'full', reason: 'not in cache' },
    });
  });

  it('reads everything when there is no cache to compare against', () => {
    expect(planRebuild([survey()], { cache: null }).orders).toEqual({
      mode: 'full',
      reason: 'no cache',
    });
  });

  it('reads everything when the cache is told to stand aside', () => {
    expect(planRebuild([survey()], { cache: cacheOf(['orders', entry()]), noCache: true }).orders)
      .toEqual({ mode: 'full', reason: 'cache ignored' });
  });

  it('reads nothing when no file moved', () => {
    expect(planRebuild([survey()], { cache: cacheOf(['orders', entry()]) }).orders).toEqual({
      mode: 'skip',
      reason: '0 files changed',
    });
  });

  it('re-reads a changed file together with the files that import it', () => {
    const plan = planRebuild([changed('src/orders/orders.service.ts')], {
      cache: cacheOf(['orders', entry()]),
    });
    expect(plan.orders).toEqual({
      mode: 'partial',
      reason: '1 files changed',
      files: [
        'src/orders/orders.controller.ts',
        'src/orders/orders.module.ts',
        'src/orders/orders.service.ts',
      ],
    });
  });

  it('re-reads everything when a file the whole repository depends on changed', () => {
    expect(planRebuild([changed('src/main.ts')], { cache: cacheOf(['orders', entry()]) }).orders)
      .toEqual({ mode: 'full', reason: 'global file src/main.ts' });
  });

  it('lets a module file be re-read as a dependent without that meaning everything', () => {
    const plan = planRebuild([changed('src/orders/orders.service.ts')], {
      cache: cacheOf(['orders', entry()]),
    });
    expect(plan.orders?.files).toContain('src/orders/orders.module.ts');
    expect(plan.orders?.mode).toBe('partial');
  });

  it('re-reads everything when the tsconfig or the package manifest changed', () => {
    expect(
      planRebuild([survey({ tsconfigHash: 'sha1:other' })], { cache: cacheOf(['orders', entry()]) })
        .orders,
    ).toEqual({ mode: 'full', reason: 'tsconfig changed' });
    expect(
      planRebuild([survey({ packageJsonHash: 'sha1:other' })], {
        cache: cacheOf(['orders', entry()]),
      }).orders,
    ).toEqual({ mode: 'full', reason: 'package.json changed' });
  });

  /**
   * Installing dependencies is a different answer to the same question.
   *
   * Over the plan rather than over a real install, which is the point: what a
   * checker can resolve is not observable from a file list, so the plan has to be
   * told, and being told is the thing worth testing. Measured on a notification service, the build
   * this replaces said `cached (0 files changed)` across an install that moved
   * entries from 415 to 420 and `http_out` from 8 to 71 (R92).
   */
  it('re-reads a repository whose dependencies arrived, were removed, or were re-locked', () => {
    const before = entry({ dependencies: { installed: [], lockfiles: { 'pnpm-lock.yaml': 'sha1:lock' } } });
    expect(
      planRebuild([survey()], { cache: cacheOf(['orders', before]) }).orders,
    ).toEqual({ mode: 'full', reason: 'dependencies installed in .' });
    expect(
      planRebuild([survey({ dependencies: { installed: [], lockfiles: { 'pnpm-lock.yaml': 'sha1:lock' } } })], {
        cache: cacheOf(['orders', entry()]),
      }).orders?.reason,
    ).toBe('dependencies removed from .');
    expect(
      planRebuild(
        [survey({ dependencies: { installed: ['.'], lockfiles: { 'pnpm-lock.yaml': 'sha1:other' } } })],
        { cache: cacheOf(['orders', entry()]) },
      ).orders?.reason,
    ).toBe('pnpm-lock.yaml changed');
  });

  it('re-reads a repository the last build recorded nothing about the dependencies of', () => {
    const { dependencies: _dependencies, ...older } = entry();
    expect(planRebuild([survey()], { cache: cacheOf(['orders', older]) }).orders?.reason).toBe(
      'dependencies not recorded by the last build',
    );
  });

  it('says nothing about dependencies that did not move', () => {
    expect(planRebuild([survey()], { cache: cacheOf(['orders', entry()]) }).orders).toEqual({
      mode: 'skip',
      reason: '0 files changed',
    });
  });

  it('re-reads everything when the repository moved or its adapters changed', () => {
    expect(
      planRebuild([survey({ repo: '../elsewhere' })], { cache: cacheOf(['orders', entry()]) }).orders
        ?.reason,
    ).toBe('repository moved');
    expect(
      planRebuild([survey({ adapters: ['nestjs-http', 'typeorm'] })], {
        cache: cacheOf(['orders', entry()]),
      }).orders?.reason,
    ).toBe('adapters changed');
  });

  it('re-reads everything when the graph it would have reused is gone or was rewritten', () => {
    expect(
      planRebuild([survey({ graphHash: null })], { cache: cacheOf(['orders', entry()]) }).orders
        ?.reason,
    ).toBe('no graph at .flowatlas/services/orders/graph.json');
    expect(
      planRebuild([survey({ graphHash: 'sha1:by-hand' })], { cache: cacheOf(['orders', entry()]) })
        .orders?.reason,
    ).toBe('graph changed outside the build');
  });

  it('re-reads everything rather than splicing when most of the repository moved at once', () => {
    const next = files();
    for (const file of ['src/orders/orders.service.ts', 'src/orders/orders.controller.ts']) {
      next[file] = stamp(`sha1:${file}-edited`, next[file]?.deps ?? []);
    }
    expect(planRebuild([survey({ files: next })], { cache: cacheOf(['orders', entry()]) }).orders)
      .toEqual({ mode: 'full', reason: '2 of 4 files changed' });
  });

  it('re-reads everything for an extractor that cannot re-read one file', () => {
    expect(
      planRebuild([changed('src/orders/orders.service.ts', { incremental: false })], {
        cache: cacheOf(['orders', entry()]),
      }).orders,
    ).toEqual({ mode: 'full', reason: 'extractor not incremental' });
  });

  it('leaves a repository no extractor can read alone', () => {
    expect(planRebuild([survey({ extractor: null })], { cache: null }).orders).toEqual({
      mode: 'skip',
      reason: 'no extractor',
    });
  });

  it('reads only the repositories named, whatever changed in the others', () => {
    const billing = survey({ service: 'billing', repo: '../billing' });
    const plan = planRebuild([changed('src/orders/orders.service.ts'), billing], {
      cache: cacheOf(['orders', entry()], ['billing', entry({ repo: '../billing' })]),
      services: ['orders'],
    });
    expect(plan.orders?.mode).toBe('partial');
    expect(plan.billing).toEqual({ mode: 'skip', reason: 'not selected' });
  });

  it('counts a deleted file among the changes, and re-reads what imported it', () => {
    const next = files();
    delete next['src/orders/orders.service.ts'];
    const plan = planRebuild([survey({ files: next })], { cache: cacheOf(['orders', entry()]) });
    expect(plan.orders?.files).toEqual([
      'src/orders/orders.controller.ts',
      'src/orders/orders.module.ts',
      'src/orders/orders.service.ts',
    ]);
  });
});

describe('hashing a graph for the rebuild plan', () => {
  it('gives two extractions of an unchanged tree the same hash', () => {
    const first = graphFile('same-a.json', '2026-01-01T00:00:00.000Z');
    const second = graphFile('same-b.json', '2026-09-25T11:22:33.444Z');
    expect(hashGraphFile(first)).toBe(hashGraphFile(second));
    // The premise of the fix: as bytes these two files genuinely differ.
    expect(hashFile(first)).not.toBe(hashFile(second));
  });

  it('still parts two graphs that say different things', () => {
    const plain = graphFile('body-a.json', '2026-01-01T00:00:00.000Z');
    const withNode = graphFile('body-b.json', '2026-01-01T00:00:00.000Z', [{ id: 'orders:one' }]);
    expect(hashGraphFile(plain)).not.toBe(hashGraphFile(withNode));
  });

  it('reads a graph reprinted with other whitespace as the same graph', () => {
    const wide = graphFile('print-a.json', '2026-01-01T00:00:00.000Z', [], 2);
    const flat = graphFile('print-b.json', '2026-01-01T00:00:00.000Z', [], 0);
    expect(hashGraphFile(wide)).toBe(hashGraphFile(flat));
  });

  it('keeps a broken graph apart from a sound one and from another broken one', () => {
    const missing = join(scratch, 'absent.json');
    const truncated = join(scratch, 'truncated.json');
    writeFileSync(truncated, '{"schemaVersion":2,"nodes":[');
    const sound = graphFile('sound.json', '2026-01-01T00:00:00.000Z');
    expect(hashGraphFile(truncated)).not.toBe(hashGraphFile(sound));
    expect(hashGraphFile(truncated)).not.toBe(hashGraphFile(missing));
  });
});

describe('planning against a graph file on disk', () => {
  it('does not re-read a repository whose graph was touched but not changed', () => {
    const path = graphFile('touched-before.json', '2026-01-01T00:00:00.000Z');
    const recorded = hashGraphFile(path);
    // Whatever rewrote the file — an editor, a sync, an abandoned extraction —
    // left the body alone and only moved the clock.
    const rewritten = graphFile('touched-after.json', '2026-09-25T09:10:11.000Z');
    const plan = planRebuild([survey({ graphPath: rewritten, graphHash: hashGraphFile(rewritten) })], {
      cache: cacheOf(['orders', entry({ graphPath: path, graphHash: recorded })]),
    });
    expect(plan.orders).toEqual({ mode: 'skip', reason: '0 files changed' });
  });

  it('re-reads a repository whose source changed, graph or no graph', () => {
    const path = graphFile('source-changed.json', '2026-01-01T00:00:00.000Z');
    const hash = hashGraphFile(path);
    const next = files();
    next['src/main.ts'] = stamp('sha1:main-edited');
    const plan = planRebuild([survey({ files: next, graphPath: path, graphHash: hash })], {
      cache: cacheOf(['orders', entry({ graphPath: path, graphHash: hash })]),
    });
    expect(plan.orders).toEqual({ mode: 'full', reason: 'global file src/main.ts' });
  });

  it('still calls out a graph whose body was edited behind the build', () => {
    const path = graphFile('edited-before.json', '2026-01-01T00:00:00.000Z');
    const recorded = hashGraphFile(path);
    const edited = graphFile('edited-after.json', '2026-01-01T00:00:00.000Z', [{ id: 'by-hand' }]);
    const plan = planRebuild([survey({ graphPath: edited, graphHash: hashGraphFile(edited) })], {
      cache: cacheOf(['orders', entry({ graphPath: path, graphHash: recorded })]),
    });
    expect(plan.orders?.reason).toBe('graph changed outside the build');
  });
});
