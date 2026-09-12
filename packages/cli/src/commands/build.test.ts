import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openGraphDb } from '@flowatlas/linker';
import { afterAll, describe, expect, it } from 'vitest';
import { loadBuildCache } from '../build/cache.js';
import { buildProject, summariseBuild, summariseRebuild } from './build.js';

const ROOT = resolve(import.meta.dirname, '../../../..');
const FIXTURES = join(ROOT, 'fixtures');
const FIXED = '2026-01-01T00:00:00.000Z';

const scratch = mkdtempSync(join(tmpdir(), 'flowatlas-build-'));

/**
 * A copy of the fixture, because these tests write into it.
 *
 * A build writes every repository's own graph and cache beside that
 * repository's source, and one test here deletes one of those directories on
 * purpose. Sharing the fixture with whatever else is running meant a rebuild
 * that should have been free sometimes answering `full (not in cache)`, about
 * one whole-suite run in four.
 *
 * Beside the fixtures rather than in a temporary directory, so the copy still
 * resolves the type stubs hoisted there.
 */
const FIXTURE = join(mkdtempSync(join(FIXTURES, '.scratch-build-')), 'multi-repo');
cpSync(join(FIXTURES, 'multi-repo'), FIXTURE, {
  recursive: true,
  filter: (from) => !from.endsWith('/.flowatlas'),
});

/**
 * Both trees, with retries.
 *
 * A recursive delete walks the tree and removes as it goes, so a directory it
 * has already emptied and is about to remove can acquire a file again before it
 * gets there, and the call fails with `ENOTEMPTY` having deleted most of what it
 * was asked to. It happened once on a build runner and never on a laptop: the
 * tree here is a whole copied fixture, a few thousand files, and the file system
 * under a container is slower at every step of it. `maxRetries` is what the API
 * offers for exactly this, and every other teardown in these packages takes it
 * too — the race belongs to the delete, not to this suite.
 */
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  rmSync(resolve(FIXTURE, '..'), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** A configuration in its own directory, pointing at the fixture repositories. */
const configFor = (name: string, services: unknown[]): string => {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'flowatlas.config.json');
  writeFileSync(
    path,
    JSON.stringify({ services, sharedPackages: ['@fx/contracts'], output: '.flowatlas' }, null, 2),
  );
  return path;
};

const service = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  repo: join(FIXTURE, name),
  type: 'nestjs',
  ...over,
});

/** The browser of the fixture, configured the way its README describes. */
const web = (over: Record<string, unknown> = {}) => ({
  name: 'web',
  repo: join(FIXTURE, 'web'),
  type: 'angular',
  apiBaseEnv: ['apiUrl', 'ordersUrl'],
  apiTarget: { apiUrl: 'gateway' },
  ...over,
});

/** A directory that looks like a repository but cannot be read. */
const brokenRepo = (): string => {
  const dir = join(scratch, 'broken-repo');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'broken', version: '0.0.0' }));
  writeFileSync(join(dir, 'tsconfig.json'), 'this is not json');
  writeFileSync(join(dir, 'src', 'main.ts'), 'export const nothing = 1;\n');
  return dir;
};

describe('building a project', () => {
  it('reads every repository and joins them', async () => {
    const config = configFor('whole', [
      service('gateway'),
      service('orders', { baseUrlEnv: ['ORDERS_URL'] }),
      service('billing', { baseUrlEnv: ['BILLING_URL'] }),
      web(),
    ]);
    const result = await buildProject({ config, builtAt: FIXED });

    expect(result.failed).toBe(false);
    expect(result.report.httpOut).toEqual({
      total: 6,
      linked: 2,
      byMarker: 1,
      unknownEnv: 1,
      noRoute: 1,
      ambiguous: 0,
      external: 1,
      // `OrdersClient.variant` writes two holes in a row, so its address could
      // be any number of segments and is matched against nothing (R01).
      dynamic: 1,
    });
    expect(result.report.ui).toEqual({
      total: 6,
      // `OrdersApiService.invoice` builds its address in a helper, and both what
      // the helper wrote and what the call passed it are kept (R05).
      // `OrdersApiService.one` goes through a helper whose optional tail nobody
      // settled, so the branch its argument takes is the answer and the edge
      // says `heuristic` (R11).
      resolved: 3,
      unresolved: 3,
      byReason: {
        'ambiguous-route-target': 1,
        'api-path-partly-read': 1,
        'target-route-not-found': 1,
      },
    });
    expect(result.project.builtAt).toBe(FIXED);
    expect(summariseBuild(result).join('\n')).toContain('calls out: 6 total, 2 linked');
    expect(summariseBuild(result).join('\n')).toContain('ui calls: 6 total, 3 joined to a route');
  }, 120_000);

  it('joins a button in the browser to the table at the far end of the project', async () => {
    const config = configFor('chain', [
      service('gateway'),
      service('orders', { baseUrlEnv: ['ORDERS_URL'] }),
      web(),
    ]);
    const result = await buildProject({ config, builtAt: FIXED });

    const db = openGraphDb(result.dbPath);
    const walk = db.traverse({
      from: 'ui_action:web#src/app/checkout.component.ts:15:22',
      direction: 'out',
      maxDepth: 12,
      maxNodes: 60,
    });
    db.close();
    expect(walk.rows.map((row) => row.edgeType)).toContain('hits');
    expect(walk.rows.map((row) => row.id)).toContain('table:orders#Order');
  }, 120_000);

  it('leaves a service no extractor can read out, without failing', async () => {
    const config = configFor('unknown-type', [
      service('orders', { baseUrlEnv: ['ORDERS_URL'] }),
      { name: 'landing', repo: join(FIXTURE, 'web'), type: 'react' },
    ]);
    const result = await buildProject({ config, builtAt: FIXED });

    expect(result.failed).toBe(false);
    expect(result.report.services.find((item) => item.name === 'landing')).toMatchObject({
      skipped: 'no-extractor',
      extractor: null,
    });
    expect(result.project.services.find((item) => item.name === 'landing')?.skipped).toBe(
      'no-extractor',
    );
  }, 120_000);

  it('leaves the browsers out when asked, and says that is why', async () => {
    const config = configFor('skip-frontend', [
      service('gateway'),
      service('orders', { baseUrlEnv: ['ORDERS_URL'] }),
      web(),
    ]);
    const result = await buildProject({ config, builtAt: FIXED, skipFrontend: true });

    expect(result.failed).toBe(false);
    expect(result.report.ui).toEqual({ total: 0, resolved: 0, unresolved: 0, byReason: {} });
    expect(result.report.services.find((item) => item.name === 'web')).toMatchObject({
      skipped: 'no-extractor',
      error: 'left out by --skip-frontend',
    });
  }, 120_000);

  it('keeps going when one repository cannot be read, and says so', async () => {
    const config = configFor('broken', [
      service('orders', { baseUrlEnv: ['ORDERS_URL'] }),
      { name: 'broken', repo: brokenRepo(), type: 'nestjs' },
    ]);
    const result = await buildProject({ config, concurrency: 2, builtAt: FIXED });

    expect(result.failed).toBe(true);
    const broken = result.report.services.find((item) => item.name === 'broken');
    expect(broken?.skipped).toBe('extract-failed');
    expect(broken?.error).toBeTruthy();
    // The repository that could be read is still in the graph.
    expect(result.report.services.find((item) => item.name === 'orders')?.nodes).toBeGreaterThan(0);
    expect(result.project.nodes.some((node) => node.repo === 'orders')).toBe(true);
  }, 120_000);

  it('writes the graph, the report and a database that agree with each other', async () => {
    const config = configFor('artefacts', [service('orders', { baseUrlEnv: ['ORDERS_URL'] })]);
    const result = await buildProject({ config, builtAt: FIXED });

    const db = openGraphDb(result.dbPath);
    expect(db.schemaVersion()).toBe(result.project.schemaVersion);
    expect(db.counts().nodes).toBe(result.project.nodes.length);
    expect(db.counts().edges).toBe(result.project.edges.length);
    expect(db.report()).toEqual(result.report);
    db.close();
  }, 120_000);

  it('reads the same repositories one at a time or several at once', async () => {
    const services = [
      service('gateway'),
      service('orders', { baseUrlEnv: ['ORDERS_URL'] }),
      service('billing', { baseUrlEnv: ['BILLING_URL'] }),
    ];
    const one = await buildProject({
      config: configFor('serial', services),
      concurrency: 1,
      builtAt: FIXED,
    });
    const many = await buildProject({
      config: configFor('parallel', services),
      concurrency: 3,
      builtAt: FIXED,
    });

    expect(JSON.stringify(one.project)).toBe(JSON.stringify(many.project));
  }, 180_000);
});

describe('building a project a second time', () => {
  const services = [service('orders', { baseUrlEnv: ['ORDERS_URL'] }), service('billing')];

  it('reads nothing when no file moved, and writes the same graph anyway', async () => {
    const config = configFor('cached', services);
    const first = await buildProject({ config, builtAt: FIXED });
    const second = await buildProject({ config, builtAt: FIXED });

    for (const name of ['orders', 'billing']) {
      expect(second.plan[name]).toEqual({ mode: 'skip', reason: '0 files changed' });
    }
    expect(second.timing.files).toEqual([]);
    expect(JSON.stringify(second.project)).toBe(JSON.stringify(first.project));
    expect(summariseBuild(second).join('\n')).toContain('cached (0 files changed)');
  }, 240_000);

  it('says how long each phase took, and which files it re-read', async () => {
    const config = configFor('timed', services);
    const result = await buildProject({ config, builtAt: FIXED });
    expect(result.timing.total).toBeGreaterThanOrEqual(0);
    expect(result.timing.hash + result.timing.extract + result.timing.link + result.timing.write)
      .toBeLessThanOrEqual(result.timing.total);
  }, 240_000);

  it('reads everything again when told to ignore the cache, and rewrites it', async () => {
    const config = configFor('ignored', services);
    await buildProject({ config, builtAt: FIXED });
    const result = await buildProject({ config, builtAt: FIXED, cache: false });

    expect(result.plan['orders']).toEqual({ mode: 'full', reason: 'cache ignored' });
    expect(loadBuildCache(result.cachePath)).toHaveProperty('cache.cacheVersion', 1);
  }, 240_000);

  it('reads everything again, saying so, when the cache is not a cache any more', async () => {
    const config = configFor('corrupt', services);
    const first = await buildProject({ config, builtAt: FIXED });
    writeFileSync(first.cachePath, '{"cacheVersion":1,');

    const result = await buildProject({ config, builtAt: FIXED });
    expect(result.cacheProblem).toBe('corrupt');
    expect(result.plan['orders']?.mode).toBe('full');
    expect(summariseBuild(result)[0]).toBe('cache-invalid:corrupt');
    expect(loadBuildCache(result.cachePath)).toHaveProperty('cache.cacheVersion', 1);
  }, 240_000);

  it('reads everything again when the tool that wrote the cache was another one', async () => {
    const config = configFor('older', services);
    const first = await buildProject({ config, builtAt: FIXED });
    const written = JSON.parse(readFileSync(first.cachePath, 'utf8'));
    written.extractors['@flowatlas/extractor-nestjs'] = '0.0.0-older';
    writeFileSync(first.cachePath, JSON.stringify(written));

    const result = await buildProject({ config, builtAt: FIXED });
    expect(result.cacheProblem).toBe('extractor');
    expect(result.plan['orders']?.mode).toBe('full');
  }, 240_000);

  it('reads everything again when the configuration itself changed', async () => {
    const config = configFor('reconfigured', services);
    await buildProject({ config, builtAt: FIXED });
    writeFileSync(
      config,
      JSON.stringify({ services, sharedPackages: [], output: '.flowatlas' }, null, 2),
    );

    const result = await buildProject({ config, builtAt: FIXED });
    expect(result.cacheProblem).toBe('config');
  }, 240_000);
});

describe('building only some of the repositories', () => {
  const services = [
    service('gateway'),
    service('orders', { baseUrlEnv: ['ORDERS_URL'] }),
    service('billing', { baseUrlEnv: ['BILLING_URL'] }),
  ];

  it('reads the one it was given and takes the others from the last build', async () => {
    const config = configFor('one-service', services);
    const whole = await buildProject({ config, builtAt: FIXED });
    const single = await buildProject({ config, builtAt: FIXED, service: ['orders'], cache: false });

    expect(single.plan['orders']?.mode).toBe('full');
    expect(single.plan['billing']).toEqual({ mode: 'skip', reason: 'not selected' });
    expect(single.plan['gateway']).toEqual({ mode: 'skip', reason: 'not selected' });
    expect(JSON.stringify(single.project)).toBe(JSON.stringify(whole.project));
  }, 240_000);

  it('refuses when a repository it would have reused has never been read', async () => {
    const config = configFor('no-graph', services);
    rmSync(join(FIXTURE, 'gateway', '.flowatlas'), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });

    await expect(
      buildProject({ config, builtAt: FIXED, service: ['orders'] }),
    ).rejects.toThrow(/missing graph for gateway/);
  }, 240_000);

  it('refuses a name no service has, and lists the ones that do', async () => {
    const config = configFor('unknown-service', services);
    await expect(buildProject({ config, service: ['nope'] })).rejects.toThrow(
      /no service named "nope"/,
    );
  }, 60_000);
});

describe('the line a rebuild prints', () => {
  it('names what was re-read, what came from the cache, and what is unresolved', async () => {
    const config = configFor('summary', [service('orders', { baseUrlEnv: ['ORDERS_URL'] })]);
    const first = await buildProject({ config, builtAt: FIXED });
    // Said before the rebuild is asked about, so a first build that fell over
    // names why instead of arriving as a rebuild that mysteriously was not free.
    expect(first.report.services.map((item) => [item.name, item.skipped ?? 'read', item.error])).toEqual([
      ['orders', 'read', undefined],
    ]);
    expect(summariseRebuild(first)).toMatch(/^rebuilt in \d+ms \(orders: full \(no cache\)\)/);

    const second = await buildProject({ config, builtAt: FIXED });
    expect(summariseRebuild(second, first.report.totals.unresolved)).toContain('nothing changed');
    expect(summariseRebuild(second, first.report.totals.unresolved + 2)).toContain('(-2)');
  }, 240_000);
});
