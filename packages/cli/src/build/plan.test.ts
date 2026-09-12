import { describe, expect, it } from 'vitest';
import { emptyCache, type BuildCache, type FileStamp, type RepoCache } from './cache.js';
import { planRebuild, type RepoSurvey } from './incremental.js';

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

const entry = (over: Partial<RepoCache> = {}): RepoCache => ({
  repo: '../orders',
  extractor: NESTJS,
  adapters: ['nestjs-http'],
  tsconfigHash: 'sha1:ts',
  packageJsonHash: 'sha1:pkg',
  globalFiles: ['src/main.ts', 'src/orders/orders.module.ts'],
  files: files(),
  graphPath: '../orders/.flowatlas/graph.json',
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
  globalFiles: ['src/main.ts', 'src/orders/orders.module.ts'],
  files: files(),
  graphPath: '../orders/.flowatlas/graph.json',
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
    ).toBe('no graph at ../orders/.flowatlas/graph.json');
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
