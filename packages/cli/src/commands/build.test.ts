import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Unresolved } from '@flowatlas/core';
import { openGraphDb } from '@flowatlas/linker';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveNodeId } from '../../../../scripts/fixture-nodes.mjs';
import { CACHE_VERSION, loadBuildCache } from '../build/cache.js';
import { serviceOutputDir } from '@flowatlas/core';
import { buildProject, inPools, serviceGraphPath, summariseBuild, summariseRebuild, unresolvedLine } from './build.js';

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
const copyOfMultiRepo = (): string => {
  const dir = join(mkdtempSync(join(FIXTURES, '.scratch-build-')), 'multi-repo');
  cpSync(join(FIXTURES, 'multi-repo'), dir, {
    recursive: true,
    filter: (from) => !from.endsWith('/.flowatlas'),
  });
  return dir;
};

const FIXTURE = copyOfMultiRepo();

/** A copy of one single-repository fixture, beside the fixtures for its stubs. */
const copyOfFixture = (name: string): string => {
  const dir = join(mkdtempSync(join(FIXTURES, '.scratch-build-')), name);
  cpSync(join(FIXTURES, name), dir, {
    recursive: true,
    filter: (from) => !from.endsWith('/.flowatlas'),
  });
  return dir;
};

const ANGULAR = copyOfFixture('angular-basic');
const REACT = copyOfFixture('react-router-config');

/**
 * A second copy, for the tests whose build is meant to fail.
 *
 * A build used to wait on its extraction pool with `Promise.all`, which settles
 * on the first rejection and leaves every sibling running. The test below
 * deletes a graph the build would have reused, so the build refuses in about
 * two milliseconds — and the extraction of `orders` it had already started went
 * on for most of a second and then wrote `orders/.flowatlas/graph.json`, long
 * after the test that caused it had finished. Measured rather than guessed: the
 * graph was rewritten roughly 720ms after the refusal, with nothing else
 * running.
 *
 * Every repository graph carries a `generatedAt`, so that late write is a
 * different file whatever the source says, and the next build over the same
 * repository answered `full (graph changed outside the build)` — correctly,
 * because something did change it. Whether it landed before or after the next
 * test recorded the graph's hash was a race, which is why the rebuild summary
 * below reddened about one run in many and passed on its own every time.
 *
 * The pool now stops what it started before it returns, and the two tests below
 * are what hold that. The separate tree stays: they are the tests that would
 * spread the damage if it ever came back, and a copy of the fixture costs one
 * directory.
 */
const DOOMED_FIXTURE = copyOfMultiRepo();

/**
 * Every tree this file made, with retries.
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
  for (const tree of [FIXTURE, DOOMED_FIXTURE, ANGULAR, REACT]) {
    rmSync(resolve(tree, '..'), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
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

const serviceIn = (root: string, name: string, over: Record<string, unknown> = {}) => ({
  name,
  repo: join(root, name),
  type: 'nestjs',
  ...over,
});

const service = (name: string, over: Record<string, unknown> = {}) =>
  serviceIn(FIXTURE, name, over);

/** The browser of the fixture, configured the way its README describes. */
const web = (over: Record<string, unknown> = {}) => ({
  name: 'web',
  repo: join(FIXTURE, 'web'),
  type: 'angular',
  apiBaseEnv: ['apiUrl', 'ordersUrl'],
  apiTarget: { apiUrl: 'gateway' },
  ...over,
});

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
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

describe('the pool the repositories are read in', () => {
  it('keeps the pool full while nothing fails', async () => {
    const seen: number[] = [];
    const results = await inPools([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item);
      await sleep(1);
      return item * 2;
    });
    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('waits for the jobs it started before it rejects', async () => {
    let running = 0;
    const promise = inPools(['fails', 'slow'], 2, async (item) => {
      running += 1;
      if (item === 'fails') {
        running -= 1;
        throw new Error('first');
      }
      await sleep(50);
      running -= 1;
    });

    await expect(promise).rejects.toThrow('first');
    // Read the instant the rejection arrives: a pool that returned early would
    // still have the slow job in flight here, which is the writer that used to
    // outlive the build.
    expect(running).toBe(0);
  });

  it('throws the first failure, not what a sibling said on its way down', async () => {
    const promise = inPools(['first', 'second'], 2, async (item) => {
      if (item === 'first') throw new Error('the one the caller asked about');
      await sleep(20);
      throw new Error('the one the abort caused');
    });
    await expect(promise).rejects.toThrow('the one the caller asked about');
  });

  it('starts nothing new once one job has failed, and tells the rest to stop', async () => {
    const started: string[] = [];
    let aborted = false;
    const promise = inPools(['bad', 'slow', 'never'], 2, async (item, signal) => {
      started.push(item);
      if (item === 'bad') throw new Error('no');
      signal.addEventListener('abort', () => {
        aborted = true;
      });
      await sleep(20);
    });

    await expect(promise).rejects.toThrow('no');
    expect(started).toEqual(['bad', 'slow']);
    expect(aborted).toBe(true);
  });
});

describe('the line the summary ends on', () => {
  const row = (over: Partial<Unresolved> = {}): Unresolved => ({
    service: 'api',
    file: 'src/a.ts',
    line: 1,
    reason: 'dynamic-http-url',
    ...over,
  });

  it('says rows and places apart when a reason was folded', () => {
    expect(unresolvedLine([row(), row({ sites: 192, level: 'info' })], 2)).toBe(
      'unresolved: 2 rows over 193 sites',
    );
  });

  it('says nothing about places where nothing joins, when there are none', () => {
    expect(unresolvedLine([row()], 1)).toBe('unresolved: 1');
  });

  // The number that matters is what was missed. Adding four hundred template
  // bindings to it would make a well-read project look like a badly read one.
  it('keeps places where nothing joins out of the count, and says them after it', () => {
    const rows = [row(), row({ level: 'nothing', sites: 397, reason: 'handler-not-a-method' })];
    expect(unresolvedLine(rows, 1)).toBe('unresolved: 1, and 397 sites with nothing to join');
  });
});

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
      total: 13,
      // `OrdersApiService.invoice` builds its address in a helper, and both what
      // the helper wrote and what the call passed it are kept (R05).
      // `OrdersApiService.one` goes through a helper whose optional tail nobody
      // settled, so the branch its argument takes is the answer and the edge
      // says `heuristic` (R11).
      // `OrdersApiService.decide` writes its last segment as one of two values
      // and both are routes, so it joins to each; `advance` writes one of two
      // and only one is a route, which is the finding worth having (R31).
      // `probe` and `twoBlind` each add an annotated request that joins and the
      // unreadable ones it sits beside: three addresses built at run time, two
      // annotations that reach a route (R39).
      resolved: 6,
      unresolved: 7,
      byReason: {
        'ambiguous-route-target': 1,
        'api-path-dynamic': 3,
        'api-path-partly-read': 1,
        'target-route-not-found': 2,
      },
    });
    expect(result.project.builtAt).toBe(FIXED);
    expect(summariseBuild(result).join('\n')).toContain('calls out: 6 total, 2 linked');
    expect(summariseBuild(result).join('\n')).toContain('ui calls: 13 total, 6 joined to a route');
  }, 120_000);

  it('joins a button in the browser to the table at the far end of the project', async () => {
    const config = configFor('chain', [
      service('gateway'),
      service('orders', { baseUrlEnv: ['ORDERS_URL'] }),
      web(),
    ]);
    const result = await buildProject({ config, builtAt: FIXED });

    // The click the whole chain starts at, asked for by the method it reaches
    // rather than by the line the template happens to sit on.
    const click = resolveNodeId(result.project, {
      type: 'ui_action',
      handling: 'web#src/app/checkout.component.ts:CheckoutComponent.checkout',
    });

    const db = openGraphDb(result.dbPath);
    const walk = db.traverse({
      from: click,
      direction: 'out',
      maxDepth: 12,
      maxNodes: 60,
    });
    db.close();
    expect(walk.rows.map((row) => row.edgeType)).toContain('hits');
    expect(walk.rows.map((row) => row.id)).toContain('table:orders#Order');
  }, 120_000);

  /**
   * The second service is typed with a word the language puts on every object.
   * The table that says which reader reads which type is asked with the `type`
   * out of a configuration file, and while it was an object literal it answered
   * `constructor` with a function - so a typo would have been planned, cached and
   * reported as a repository with a reader, and whatever that function returned
   * would have been its extractor's name. It is a `Map` now and the answer is the
   * same as for `svelte`: no reader, no nodes (R134).
   */
  it('leaves a service no extractor can read out, without failing', async () => {
    const config = configFor('unknown-type', [
      service('orders', { baseUrlEnv: ['ORDERS_URL'] }),
      { name: 'landing', repo: join(FIXTURE, 'web'), type: 'svelte' },
      { name: 'mistyped', repo: join(FIXTURE, 'web'), type: 'constructor' },
    ]);
    const result = await buildProject({ config, builtAt: FIXED });

    expect(result.failed).toBe(false);
    for (const name of ['landing', 'mistyped']) {
      expect(result.report.services.find((item) => item.name === name), name).toMatchObject({
        skipped: 'no-extractor',
        extractor: null,
        nodes: 0,
      });
      expect(result.project.services.find((item) => item.name === name)?.skipped, name).toBe(
        'no-extractor',
      );
    }
    expect(result.project.nodes.filter((node) => node.repo === 'mistyped')).toEqual([]);
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

  it('leaves the last good graph alone when a repository could not be read', async () => {
    const good = [service('orders', { baseUrlEnv: ['ORDERS_URL'] })];
    const broken = [...good, { name: 'broken', repo: brokenRepo(), type: 'nestjs' }];
    // One configuration for both builds, so both write to one output directory:
    // the whole question is what the second build does to what the first wrote.
    const dir = join(scratch, 'kept');
    mkdirSync(dir, { recursive: true });
    const configPath = join(dir, 'flowatlas.config.json');
    const write = (services: unknown[]): void =>
      writeFileSync(
        configPath,
        JSON.stringify({ services, sharedPackages: ['@fx/contracts'], output: '.flowatlas' }, null, 2),
      );

    write(good);
    const first = await buildProject({ config: configPath, builtAt: FIXED });
    expect(first.wrote).toBe(true);
    const before = readFileSync(first.graphPath, 'utf8');
    expect(JSON.parse(before).nodes.length).toBeGreaterThan(0);

    write(broken);
    const second = await buildProject({ config: configPath, builtAt: FIXED, cache: false });
    expect(second.failed).toBe(true);
    expect(second.wrote).toBe(false);
    // The point of the whole ticket: the graph on disk is the good one, not this
    // build's smaller answer, and not an empty file with a clean bill of health
    // waiting to be read off it.
    expect(readFileSync(first.graphPath, 'utf8')).toBe(before);
    expect(summariseBuild(second).join('\n')).toContain('was left as the last build wrote it');

    // And with nothing to keep, the partial answer is written, because something
    // has to explain the failure to whatever reads the output next.
    rmSync(second.graphPath, { force: true });
    const third = await buildProject({ config: configPath, builtAt: FIXED, cache: false });
    expect(third.failed).toBe(true);
    expect(third.wrote).toBe(true);
    expect(readFileSync(third.graphPath, 'utf8')).not.toBe(before);
  }, 240_000);

  it('names a service that was read and contributed nothing, and says why', async () => {
    const config = join(FIXTURES, 'next-hollow', 'flowatlas.config.json');
    const result = await buildProject({ config, builtAt: FIXED, cache: false });

    expect(result.readNothing.map((found) => found.service)).toEqual(['widget']);
    const summary = summariseBuild(result).join('\n');
    expect(summary).toContain('widget contributed no node');
    expect(summary).toContain('no frontend adapter recognises it');
    // A row as well as a line, so the fact reaches `doctor` rather than only the
    // terminal the build was run in.
    expect(
      result.project.unresolved.filter((row) => row.reason === 'service-read-nothing'),
    ).toHaveLength(1);
  }, 240_000);

  it('counts ways in apart from ways in whose body was read', async () => {
    const config = join(FIXTURES, 'next-hollow', 'flowatlas.config.json');
    const result = await buildProject({ config, builtAt: FIXED, cache: false });

    // Seven ways in: one declares its handler in place, one is built by a
    // factory this repository declares and is read through it (R153). Every
    // other spelling in that fixture is a way in with nothing behind it, and
    // each one is a row (R94).
    expect(summariseBuild(result).join('\n')).toContain(
      'ways in: 7 found, 2 with a handler that was read, 5 without',
    );
    const unread = result.project.unresolved.filter((row) => row.reason === 'route-handler-unread');
    expect(unread).toHaveLength(5);
    expect(unread.map((row) => row.symbol)).not.toContain('GET /api/products');
    const products = result.project.nodes.find((node) => node.id === 'entry:shop:http:GET:/api/products');
    expect(products?.meta?.['handlerVia']).toBe('call');
    expect(result.project.edges).toContainEqual(
      expect.objectContaining({
        from: 'entry:shop:http:GET:/api/products',
        to: 'shop#lib/products.ts:handlerBuilder',
        type: 'handles',
      }),
    );
  }, 240_000);

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

  it('reads a repository again when a type stub it was read against is edited', async () => {
    const config = configFor('stubbed', services);
    await buildProject({ config, builtAt: FIXED });
    const stub = join(FIXTURE, 'orders', 'node_modules', 'typeorm', 'index.d.ts');
    const original = readFileSync(stub, 'utf8');

    // Rewritten with the same content, the way a reinstall does: no change.
    writeFileSync(stub, original);
    const reinstalled = await buildProject({ config, builtAt: FIXED });
    expect(reinstalled.plan['orders']).toEqual({ mode: 'skip', reason: '0 files changed' });

    try {
      writeFileSync(stub, `${original}\n// edited\n`);
      const edited = await buildProject({ config, builtAt: FIXED });
      expect(edited.plan['orders']).toEqual({
        mode: 'full',
        reason: 'installed node_modules/typeorm/index.d.ts changed',
      });
      expect(edited.plan['billing']).toEqual({ mode: 'skip', reason: '0 files changed' });
    } finally {
      writeFileSync(stub, original);
    }
  }, 240_000);

  it('reads a browser repository again when a type stub it was read against is edited', async () => {
    const config = configFor('stubbed-browser', [web({ apiTarget: {} })]);
    await buildProject({ config, builtAt: FIXED });
    const stub = join(FIXTURE, 'web', 'node_modules', '@angular', 'common', 'http', 'index.d.ts');
    const original = readFileSync(stub, 'utf8');
    const settled = await buildProject({ config, builtAt: FIXED });
    expect(settled.plan['web']).toEqual({ mode: 'skip', reason: '0 files changed' });
    try {
      writeFileSync(stub, `${original}\n// edited\n`);
      const edited = await buildProject({ config, builtAt: FIXED });
      expect(edited.plan['web']).toEqual({
        mode: 'full',
        reason: 'installed node_modules/@angular/common/http/index.d.ts changed',
      });
    } finally {
      writeFileSync(stub, original);
    }
  }, 240_000);

  it('settles a browser repository, and reads it again when a template it reads is edited', async () => {
    const config = configFor('angular-template', [
      { name: 'shop', repo: ANGULAR, type: 'angular', apiBaseEnv: ['apiUrl'] },
    ]);
    await buildProject({ config, builtAt: FIXED });
    // What the reading recorded and what the survey lists are one list, so a
    // build with nothing moved reads nothing.
    const settled = await buildProject({ config, builtAt: FIXED });
    expect(settled.plan['shop']).toEqual({ mode: 'skip', reason: '0 files changed' });

    const template = join(ANGULAR, 'src', 'app', 'orders-list.component.html');
    writeFileSync(template, `${readFileSync(template, 'utf8')}\n<button (click)="load()">again</button>\n`);
    const edited = await buildProject({ config, builtAt: FIXED });
    expect(edited.plan['shop']?.mode).toBe('full');
  }, 240_000);

  it('settles a React repository, and reads it again when a script file beside its sources moves', async () => {
    const config = configFor('react-script', [{ name: 'app', repo: REACT, type: 'react' }]);
    await buildProject({ config, builtAt: FIXED });
    const settled = await buildProject({ config, builtAt: FIXED });
    expect(settled.plan['app']).toEqual({ mode: 'skip', reason: '0 files changed' });

    writeFileSync(join(REACT, 'app', 'legacy.jsx'), 'export const Legacy = () => null;\n');
    const edited = await buildProject({ config, builtAt: FIXED });
    expect(edited.plan['app']?.mode).toBe('full');
  }, 240_000);

  it('reads everything again when told to ignore the cache, and rewrites it', async () => {
    const config = configFor('ignored', services);
    await buildProject({ config, builtAt: FIXED });
    const result = await buildProject({ config, builtAt: FIXED, cache: false });

    expect(result.plan['orders']).toEqual({ mode: 'full', reason: 'cache ignored' });
    expect(loadBuildCache(result.cachePath)).toHaveProperty('cache.cacheVersion', CACHE_VERSION);
  }, 240_000);

  it('reads everything again, saying so, when the cache is not a cache any more', async () => {
    const config = configFor('corrupt', services);
    const first = await buildProject({ config, builtAt: FIXED });
    writeFileSync(first.cachePath, '{"cacheVersion":1,');

    const result = await buildProject({ config, builtAt: FIXED });
    expect(result.cacheProblem).toBe('corrupt');
    expect(result.plan['orders']?.mode).toBe('full');
    expect(summariseBuild(result)[0]).toBe('cache-invalid:corrupt');
    expect(loadBuildCache(result.cachePath)).toHaveProperty('cache.cacheVersion', CACHE_VERSION);
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

  // On its own tree, because a build that refuses used to leave the extraction
  // it had already started running, and that extraction rewrote a repository
  // graph some later test was entitled to find unchanged. See `DOOMED_FIXTURE`.
  it('refuses when a repository it would have reused has never been read', async () => {
    const doomed = [
      serviceIn(DOOMED_FIXTURE, 'gateway'),
      serviceIn(DOOMED_FIXTURE, 'orders', { baseUrlEnv: ['ORDERS_URL'] }),
    ];
    // A graph to reuse has to exist before one can be taken away; on a tree
    // nothing has been built in, every skipped repository is missing one and
    // the message could name any of them.
    const config = configFor('no-graph-first', doomed);
    const first = await buildProject({ config, builtAt: FIXED });
    rmSync(serviceOutputDir(first.outputDir, 'gateway'), {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });

    const graphPath = serviceGraphPath(first.outputDir, 'orders');
    const before = readFileSync(graphPath, 'utf8');

    // The message names where the graph was looked for, which is under the
    // build's output and not in the repository.
    const refused = buildProject({ config, builtAt: FIXED, service: ['orders'] });
    await expect(refused).rejects.toThrow(/missing graph for gateway/);
    await expect(refused).rejects.toThrow(serviceGraphPath(first.outputDir, 'gateway'));

    // The refusal costs two milliseconds and the extraction of `orders` it had
    // already started costs most of a second, so a build that returned without
    // waiting left a writer behind. A second of quiet is several times what
    // that writer was measured to need, and the graph has to be the same file
    // at the end of it: whatever the build did with the extraction it started,
    // it did before it answered.
    await sleep(1_000);
    expect(readFileSync(graphPath, 'utf8')).toBe(before);
  }, 240_000);

  // Two builds in one process, which is what a watch, the server and any
  // embedder do. The first refuses; the second must see the tree the first one
  // found, not a version of it some orphan of the first one rewrote.
  it('leaves the next build in the same process nothing to trip over', async () => {
    const doomed = [
      serviceIn(DOOMED_FIXTURE, 'gateway'),
      serviceIn(DOOMED_FIXTURE, 'orders', { baseUrlEnv: ['ORDERS_URL'] }),
    ];
    const result = await buildProject({
      config: configFor('no-graph-first', doomed),
      builtAt: FIXED,
    });

    // `gateway` is read in full because the test above deleted its graph, which
    // is the point: the refusing build only ever had a reason to touch
    // `orders`, and `orders` is where a late write would show, as a graph whose
    // `generatedAt` no longer matches the hash the first build recorded.
    expect(result.plan['orders']).toEqual({ mode: 'skip', reason: '0 files changed' });
  }, 240_000);

  it('refuses a name no service has, and lists the ones that do', async () => {
    const config = configFor('unknown-service', services);
    await expect(buildProject({ config, service: ['nope'] })).rejects.toThrow(
      /no service named "nope"/,
    );
  }, 60_000);
});

/**
 * What a build says when a reader runs out of memory, and what it costs.
 *
 * Both halves of R98. The first is a sentence: heap exhaustion happens inside
 * the process reading one repository, it ends in a stack trace rather than a
 * complaint, and what used to reach the summary was three addresses inside a
 * dynamic library. The second is a number: the largest fixture builds under a
 * heap small enough that doubling what the tool uses would redden this.
 */
describe('a repository that does not fit in memory', () => {
  const runCli = promisify(execFile);
  const CLI = join(ROOT, 'packages', 'cli', 'bin', 'flowatlas.js');

  it('says so in its own words, naming the repository and the way out', async () => {
    const config = configFor('tiny-heap', [serviceIn(DOOMED_FIXTURE, 'orders')]);
    // Small enough that reading four files does not fit, and large enough that
    // the runtime still starts: 64 MB was measured to fail on this fixture and
    // 160 MB to pass.
    const result = await buildProject({ config, builtAt: FIXED, heap: 64, cache: false });

    expect(result.failed).toBe(true);
    const [orders] = result.report.services;
    expect(orders?.skipped).toBe('extract-failed');
    expect(orders?.error).toContain('ran out of memory reading');
    expect(orders?.error).toContain('orders');
    expect(orders?.error).toContain('under a limit of 64 MB');
    expect(orders?.error).toContain('--heap 128');
    // The words that used to arrive instead of any of that.
    expect(orders?.error).not.toMatch(/libnode|dyld|0x[0-9a-f]{6}/);
    expect(summariseBuild(result).join('\n')).toContain('ran out of memory reading');
  }, 240_000);

  /**
   * The number to regress against.
   *
   * Measured on 2026-09-27: the four repositories of `multi-repo`, the largest
   * fixture here, build to completion with an old-space limit of 128 MB and peak
   * at 0.31 GB of resident memory for the whole process tree. The limit asserted
   * is twice what was needed, so this is quiet about ordinary drift and loud
   * about the kind of change that took the tool from 1.4 GB on one real
   * repository to more than 10 on another.
   *
   * A limit rather than a measurement on purpose: peak resident memory depends
   * on what else the machine is doing, and a test that reads it would be a test
   * that reddens for reasons nobody can act on.
   */
  it('builds the largest fixture under a heap of 256 MB', async () => {
    const tree = copyOfMultiRepo();
    try {
      // On the environment, so the reader processes inherit it: the flag this
      // build would otherwise choose for itself stands aside for one that was
      // asked for, and this asserts the whole tree fits and not just the parent.
      await runCli(process.execPath, [CLI, 'build', tree, '--out', join(tree, '..', 'out')], {
        env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=256' },
        maxBuffer: 64 * 1024 * 1024,
      });
    } finally {
      rmSync(resolve(tree, '..'), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 240_000);
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
