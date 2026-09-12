import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '@flowatlas/core';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CACHE_VERSION,
  diffRepoFiles,
  emptyCache,
  hashConfig,
  hashFile,
  loadBuildCache,
  saveBuildCache,
  stampFiles,
  type BuildCache,
  type CacheExpectations,
  type RepoCache,
} from './cache.js';

const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-cache-'));

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const expected: CacheExpectations = {
  schemaVersion: 2,
  flowatlasVersion: '0.4.0',
  extractors: { '@flowatlas/extractor-nestjs': '0.4.0' },
  configHash: 'sha1:abc',
};

const repoEntry = (over: Partial<RepoCache> = {}): RepoCache => ({
  repo: '../orders',
  extractor: '@flowatlas/extractor-nestjs',
  adapters: ['nestjs-http'],
  tsconfigHash: 'sha1:ts',
  packageJsonHash: 'sha1:pkg',
  globalFiles: ['src/main.ts'],
  files: {
    'src/orders/orders.service.ts': {
      hash: 'sha1:one',
      size: 10,
      mtimeMs: 1,
      deps: ['src/orders/order.dto.ts'],
    },
    'src/orders/order.dto.ts': { hash: 'sha1:two', size: 20, mtimeMs: 2, deps: [] },
  },
  graphPath: '../orders/.flowatlas/graph.json',
  graphHash: 'sha1:graph',
  counts: { nodes: 1, edges: 2, types: 3, unresolved: 4 },
  ...over,
});

const cacheWith = (over: Partial<BuildCache> = {}): BuildCache => ({
  ...emptyCache(expected, '2026-01-01T00:00:00.000Z'),
  repos: { orders: repoEntry() },
  ...over,
});

/** A cache file in a directory of its own, so tests never share one. */
const cacheAt = (name: string, contents: string | BuildCache): string => {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'cache.json');
  if (typeof contents === 'string') writeFileSync(path, contents);
  else saveBuildCache(path, contents);
  return path;
};

describe('the build cache file', () => {
  it('comes back the way it went in', () => {
    const path = cacheAt('round-trip', cacheWith());
    const loaded = loadBuildCache(path, expected);
    expect(loaded).toEqual({ cache: cacheWith() });
  });

  it('is nothing at all when there is no file, which is not a problem', () => {
    expect(loadBuildCache(join(scratch, 'nowhere', 'cache.json'))).toBeNull();
  });

  it('is refused as corrupt when it is not the shape it claims', () => {
    expect(loadBuildCache(cacheAt('truncated', '{"cacheVersion":1,'), expected)).toEqual({
      problem: 'corrupt',
    });
    expect(loadBuildCache(cacheAt('wrong-shape', '{"cacheVersion":1,"repos":3}'), expected)).toEqual(
      { problem: 'corrupt' },
    );
  });

  it('names the version, the schema, the extractor and the configuration that disagree', () => {
    const table: Array<[string, Partial<BuildCache>, string]> = [
      ['version', { cacheVersion: CACHE_VERSION + 1 }, 'version'],
      ['schema', { schemaVersion: 99 }, 'schema'],
      ['flowatlas', { flowatlasVersion: '0.3.0' }, 'extractor'],
      ['extractor', { extractors: { '@flowatlas/extractor-nestjs': '0.3.0' } }, 'extractor'],
      ['config', { configHash: 'sha1:other' }, 'config'],
    ];
    for (const [name, over, problem] of table) {
      expect(loadBuildCache(cacheAt(`stale-${name}`, cacheWith(over)), expected)).toEqual({
        problem,
      });
    }
  });

  it('is read without judgement when the caller has nothing to compare it against', () => {
    const path = cacheAt('unjudged', cacheWith({ configHash: 'sha1:other' }));
    expect(loadBuildCache(path)).toEqual({ cache: cacheWith({ configHash: 'sha1:other' }) });
  });

  it('survives a run that is cut short, because it is renamed into place', () => {
    const path = cacheAt('atomic', cacheWith());
    saveBuildCache(path, cacheWith({ builtAt: '2026-02-02T00:00:00.000Z' }));
    const loaded = loadBuildCache(path, expected);
    expect(loaded).toHaveProperty('cache.builtAt', '2026-02-02T00:00:00.000Z');
  });
});

describe('the hash of the configuration', () => {
  it('ignores the order another tool happened to write the keys in', () => {
    const one = parseConfig({ output: '.flowatlas', sharedPackages: ['@fx/contracts'], services: [] });
    const other = parseConfig({ services: [], sharedPackages: ['@fx/contracts'], output: '.flowatlas' });
    expect(hashConfig(one)).toBe(hashConfig(other));
  });

  it('changes when anything the analysis depends on changes', () => {
    const one = parseConfig({ sharedPackages: ['@fx/contracts'] });
    const other = parseConfig({ sharedPackages: ['@fx/events'] });
    expect(hashConfig(one)).not.toBe(hashConfig(other));
  });
});

describe('comparing a repository against the cache', () => {
  it('separates what appeared, what changed and what is gone', () => {
    const current = {
      'src/orders/orders.service.ts': { hash: 'sha1:changed', size: 11, mtimeMs: 3, deps: [] },
      'src/orders/orders.controller.ts': { hash: 'sha1:new', size: 5, mtimeMs: 4, deps: [] },
    };
    expect(diffRepoFiles(repoEntry(), current)).toEqual({
      added: ['src/orders/orders.controller.ts'],
      changed: ['src/orders/orders.service.ts'],
      removed: ['src/orders/order.dto.ts'],
    });
  });

  it('finds nothing when nothing moved', () => {
    const entry = repoEntry();
    expect(diffRepoFiles(entry, entry.files)).toEqual({ added: [], changed: [], removed: [] });
  });

  it('treats a repository it has never seen as entirely new', () => {
    const entry = repoEntry();
    expect(diffRepoFiles(undefined, entry.files).added).toHaveLength(2);
  });
});

describe('stamping the files of a repository', () => {
  const repoDir = join(scratch, 'stamped');
  mkdirSync(repoDir, { recursive: true });
  const file = join(repoDir, 'one.ts');
  writeFileSync(file, 'export const one = 1;\n');

  it('reads every file when the timestamps are not to be trusted', () => {
    const first = stampFiles(repoDir, ['one.ts'], undefined, {});
    writeFileSync(file, 'export const one = 2;\n');
    utimesSync(file, new Date(1), new Date(1));
    const previous = { 'one.ts': { ...first['one.ts']!, size: 21, mtimeMs: 1000 } };
    const again = stampFiles(repoDir, ['one.ts'], previous, {});
    expect(again['one.ts']?.hash).toBe(hashFile(file));
    expect(again['one.ts']?.hash).not.toBe(first['one.ts']?.hash);
  });

  it('takes the recorded hash on trust only under a watch', () => {
    const stamp = stampFiles(repoDir, ['one.ts'], undefined, {});
    const previous = { 'one.ts': { ...stamp['one.ts']!, hash: 'sha1:pretend' } };
    expect(stampFiles(repoDir, ['one.ts'], previous, { trustTimestamps: true })['one.ts']?.hash).toBe(
      'sha1:pretend',
    );
    expect(stampFiles(repoDir, ['one.ts'], previous, {})['one.ts']?.hash).not.toBe('sha1:pretend');
  });

  it('carries the imports of a file that did not change', () => {
    const previous = {
      'one.ts': { hash: hashFile(file), size: 0, mtimeMs: 0, deps: ['two.ts'] },
    };
    expect(stampFiles(repoDir, ['one.ts'], previous, {})['one.ts']?.deps).toEqual(['two.ts']);
  });

  it('says a file that is gone is empty rather than throwing', () => {
    expect(stampFiles(repoDir, ['missing.ts'], undefined, {})['missing.ts']).toEqual({
      hash: hashFile(join(repoDir, 'missing.ts')),
      size: 0,
      mtimeMs: 0,
      deps: [],
    });
  });
});
