import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { isWithinDir, type RepoGraph } from '@flowatlas/core';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { loadBuildCache } from '../build/cache.js';
import { watchProject, type OpenWatcher, type WatchHandle, type WatchIgnored } from '../build/watch.js';
import type { WatchEventName } from '../build/watch-surroundings.js';
import { buildProject, serviceGraphPath, type BuildResult } from './build.js';

/**
 * What stands in for a package that is not installed (P78) is part of what a
 * cached graph depends on (P83). Each case copies the fixture, builds it, moves
 * what would stand in without touching a file of the repository, and builds
 * again: the importer is read again, the plan says why, and the graph is the
 * one a reading from nothing gives.
 */

const FIXTURE = resolve(import.meta.dirname, '../../../../fixtures/uninstalled-internal-packages');
const FIXED = '2026-01-01T00:00:00.000Z';
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-stand-ins-cache-')));
let copies = 0;

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** A fresh copy of the fixture, without the output a run of it left. */
const copyOfFixture = (): string => {
  const dir = join(scratch, `copy-${(copies += 1)}`);
  cpSync(FIXTURE, dir, { recursive: true });
  rmSync(join(dir, '.flowatlas'), { recursive: true, force: true });
  return dir;
};

const write = (root: string, path: string, body: unknown): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`);
};

const build = (root: string): Promise<BuildResult> =>
  buildProject({ config: join(root, 'flowatlas.config.json'), builtAt: FIXED });

const graphOf = (result: BuildResult, service: string): RepoGraph =>
  JSON.parse(readFileSync(serviceGraphPath(result.outputDir, service), 'utf8')) as RepoGraph;

const rowsOf = (graph: RepoGraph, reason: string): string[] =>
  graph.unresolved
    .filter((row) => row.reason === reason || row.meta?.['cause'] === reason)
    .map((row) => (typeof row.meta?.['package'] === 'string' ? row.meta['package'] : (row.symbol ?? row.file)))
    .sort();

/** A graph as two readings are compared: through JSON, without the time it was made. */
const comparable = (graph: RepoGraph): unknown => {
  const { generatedAt: _, ...rest } = JSON.parse(JSON.stringify(graph)) as RepoGraph;
  return rest;
};

/** The graph a build with no cache reads, for the same disk. */
const fromNothing = async (root: string, service: string): Promise<unknown> => {
  const result = await buildProject({
    config: join(root, 'flowatlas.config.json'),
    builtAt: FIXED,
    cache: false,
    out: join(root, '.from-nothing'),
  });
  return comparable(graphOf(result, service));
};

const FLAGS_SHAPE = [
  "declare module '@acme/feature-flags' {",
  '  export class FlagClient { variant(name: string): { amount: number }; }',
  '  export function isOn(name: string): boolean;',
  '}',
  '',
].join('\n');

/** A directory beside the configuration whose manifest is the name `loans-api` imports and nothing answers. */
const addFlagsLibrary = (root: string): void => {
  write(root, 'flags-lib/package.json', { name: '@acme/feature-flags', version: '1.2.0', main: 'src/index.ts' });
  write(
    root,
    'flags-lib/src/index.ts',
    [
      'export class FlagClient { variant(name: string): { amount: number } { return { amount: name.length }; } }',
      'export const isOn = (name: string): boolean => name.length > 0;',
      '',
    ].join('\n'),
  );
};

describe('a cached graph whose stand-ins moved', () => {
  it('records what stood in, and a build with nothing moved reads nothing', async () => {
    const root = copyOfFixture();
    const first = await build(root);
    expect(first.plan['loans-api']?.mode).toBe('full');
    const loaded = loadBuildCache(first.cachePath);
    if (loaded === null || 'problem' in loaded) throw new Error('no cache');
    expect(loaded.cache.cacheVersion).toBe(5);
    const recorded = loaded.cache.repos['loans-api']?.standIns;
    expect(recorded?.shapes).toEqual({ 'flowatlas-shapes/acme-queue-client.d.ts': expect.stringMatching(/^sha1:/) });
    expect(recorded?.packages['@acme/feature-flags']).toBeNull();
    expect(recorded?.packages['@acme/money']).toEqual({ dir: 'money-lib', manifestHash: expect.stringMatching(/^sha1:/) });
    expect(Object.keys(recorded?.packages ?? {})).toContain('@acme/queue-client');

    const second = await build(root);
    expect(second.plan['loans-api']).toEqual({ mode: 'skip', reason: '0 files changed' });
    expect(second.plan['money-lib']).toEqual({ mode: 'skip', reason: '0 files changed' });
  }, 120_000);

  it('reads the importer again when a shape file is added under a listed glob', async () => {
    const root = copyOfFixture();
    const first = await build(root);
    expect(rowsOf(graphOf(first, 'loans-api'), 'module-not-installed')).toContain('@acme/feature-flags');

    write(root, 'flowatlas-shapes/acme-feature-flags.d.ts', FLAGS_SHAPE);
    const second = await build(root);
    expect(second.plan['loans-api']).toEqual({
      mode: 'full',
      reason: 'stand-ins changed: shape file flowatlas-shapes/acme-feature-flags.d.ts added',
    });
    const graph = graphOf(second, 'loans-api');
    expect(rowsOf(graph, 'module-not-installed')).not.toContain('@acme/feature-flags');
    expect(comparable(graph)).toEqual(await fromNothing(root, 'loans-api'));

    rmSync(join(root, 'flowatlas-shapes/acme-feature-flags.d.ts'));
    const third = await build(root);
    expect(third.plan['loans-api']).toEqual({
      mode: 'full',
      reason: 'stand-ins changed: shape file flowatlas-shapes/acme-feature-flags.d.ts removed',
    });
    expect(rowsOf(graphOf(third, 'loans-api'), 'module-not-installed')).toContain('@acme/feature-flags');
  }, 120_000);

  it('reads the importer again when a package directory now answers a missing import', async () => {
    const root = copyOfFixture();
    await build(root);

    addFlagsLibrary(root);
    const second = await build(root);
    expect(second.plan['loans-api']).toEqual({
      mode: 'full',
      reason: 'stand-ins changed: package @acme/feature-flags now at flags-lib',
    });
    const graph = graphOf(second, 'loans-api');
    expect(rowsOf(graph, 'package-from-repo')).toContain('@acme/feature-flags');
    expect(rowsOf(graph, 'module-not-installed')).not.toContain('@acme/feature-flags');
    expect(comparable(graph)).toEqual(await fromNothing(root, 'loans-api'));
    // money-lib never wanted the package, so a new one says nothing to it.
    expect(second.plan['money-lib']).toEqual({ mode: 'skip', reason: '0 files changed' });
  }, 120_000);

  it('reads the importer again when one of two directories claiming a name goes away', async () => {
    const root = copyOfFixture();
    // Only loans-api is configured: money-lib and money-lib-copy are both
    // directories beside the configuration, one tier, one name.
    write(root, 'flowatlas.config.json', {
      ...JSON.parse(readFileSync(join(root, 'flowatlas.config.json'), 'utf8')),
      services: [{ name: 'loans-api', repo: './loans-api', type: 'nestjs' }],
    });
    const first = await build(root);
    expect(rowsOf(graphOf(first, 'loans-api'), 'package-source-ambiguous')).toEqual(['@acme/money']);

    rmSync(join(root, 'money-lib-copy'), { recursive: true });
    const second = await build(root);
    expect(second.plan['loans-api']).toEqual({
      mode: 'full',
      reason: 'stand-ins changed: package @acme/money now at money-lib',
    });
    const graph = graphOf(second, 'loans-api');
    expect(rowsOf(graph, 'package-source-ambiguous')).toEqual([]);
    expect(rowsOf(graph, 'package-from-repo')).toContain('@acme/money');
    expect(comparable(graph)).toEqual(await fromNothing(root, 'loans-api'));

    // And back: a second directory claiming it again is said, not ignored.
    cpSync(join(root, 'money-lib'), join(root, 'money-lib-copy'), { recursive: true });
    const third = await build(root);
    expect(third.plan['loans-api']).toEqual({
      mode: 'full',
      reason: 'stand-ins changed: package @acme/money now claimed by 2 directories (money-lib, money-lib-copy)',
    });
    expect(rowsOf(graphOf(third, 'loans-api'), 'package-source-ambiguous')).toEqual(['@acme/money']);
  }, 120_000);

  it('does not read a service again for a package nothing in it wanted', async () => {
    const root = copyOfFixture();
    await build(root);
    write(root, 'ledger-lib/package.json', { name: '@acme/ledger', version: '1.0.0', main: 'src/index.ts' });
    write(root, 'ledger-lib/src/index.ts', 'export const ledger = 1;\n');
    const second = await build(root);
    expect(second.plan['loans-api']).toEqual({ mode: 'skip', reason: '0 files changed' });
    expect(second.plan['money-lib']).toEqual({ mode: 'skip', reason: '0 files changed' });
  }, 120_000);

  it('reads an entry that does not say what stood in again', async () => {
    const root = copyOfFixture();
    const first = await build(root);
    const cache = JSON.parse(readFileSync(first.cachePath, 'utf8')) as {
      repos: Record<string, { standIns?: unknown }>;
    };
    delete cache.repos['loans-api']?.standIns;
    writeFileSync(first.cachePath, JSON.stringify(cache));
    const second = await build(root);
    expect(second.plan['loans-api']).toEqual({ mode: 'full', reason: 'stand-ins not recorded by the last build' });
    expect(second.plan['money-lib']).toEqual({ mode: 'skip', reason: '0 files changed' });
  }, 120_000);
});

/**
 * A watcher that reports what a test tells it to, the way chokidar would (P206):
 * an event under one of its directories, every directory on the way and the
 * path itself past its `ignored`. Nothing waits on a kernel, so what a test
 * asserts is what the watch did with the event and not when it heard it.
 */
const fakeWatchers = (): {
  openWatcher: OpenWatcher;
  emit: (event: WatchEventName, path: string) => void;
  /** How many watchers were ever started on a directory. */
  opened: (dir: string) => number;
  /** How many are watching it now. */
  open: (dir: string) => number;
} => {
  interface Fake {
    roots: Set<string>;
    ignored: WatchIgnored;
    listeners: Array<(event: WatchEventName, path: string) => void>;
    closed: boolean;
  }
  const all: Fake[] = [];
  const openWatcher: OpenWatcher = async (paths, ignored) => {
    const fake: Fake = { roots: new Set(paths), ignored, listeners: [], closed: false };
    all.push(fake);
    return {
      on: (listener) => {
        fake.listeners.push(listener);
      },
      add: (more) => more.forEach((dir) => fake.roots.add(dir)),
      unwatch: (gone) => gone.forEach((dir) => fake.roots.delete(dir)),
      close: async () => {
        fake.closed = true;
      },
    };
  };
  const sees = (fake: Fake, path: string, kind: 'dir' | 'file'): boolean =>
    [...fake.roots].some((root) => {
      if (!isWithinDir(path, root)) return false;
      const parts = relative(root, path).split(sep).filter((part) => part !== '');
      for (let depth = 1; depth < parts.length; depth += 1) {
        if (fake.ignored(join(root, ...parts.slice(0, depth)), 'dir')) return false;
      }
      return !fake.ignored(path, kind);
    });
  const emit = (event: WatchEventName, path: string): void => {
    const kind = event === 'addDir' || event === 'unlinkDir' ? 'dir' : 'file';
    for (const fake of all) {
      if (fake.closed || !sees(fake, path, kind)) continue;
      for (const listener of fake.listeners) listener(event, path);
    }
  };
  const opened = (dir: string): number => all.filter((fake) => fake.roots.has(dir)).length;
  const open = (dir: string): number => all.filter((fake) => !fake.closed && fake.roots.has(dir)).length;
  return { openWatcher, emit, opened, open };
};

describe('a watch whose stand-ins moved', () => {
  let handle: WatchHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  /** A watch of a fresh copy, through the fake watcher, and the rebuilds it makes. */
  const watching = async (): Promise<{
    root: string;
    rebuilds: BuildResult[];
    printed: string[];
    fake: ReturnType<typeof fakeWatchers>;
    /** The rebuilds an event earned, once the watch has gone quiet. */
    after: (event: WatchEventName, path: string) => Promise<BuildResult[]>;
  }> => {
    const root = copyOfFixture();
    const rebuilds: BuildResult[] = [];
    const printed: string[] = [];
    const fake = fakeWatchers();
    handle = await watchProject({
      config: join(root, 'flowatlas.config.json'),
      builtAt: FIXED,
      debounceMs: 10,
      print: (line) => printed.push(line),
      onRebuild: (result) => rebuilds.push(result),
      openWatcher: fake.openWatcher,
    });
    const watch = handle;
    const after = async (event: WatchEventName, path: string): Promise<BuildResult[]> => {
      const before = rebuilds.length;
      fake.emit(event, join(root, ...path.split('/')));
      await watch.settled();
      return rebuilds.slice(before);
    };
    return { root, rebuilds, printed, fake, after };
  };

  it('says what it watches beside the repositories', async () => {
    const { printed } = await watching();
    expect(printed.at(-1)).toBe('watching 2 repositories, the directories beside the configuration and 1 shapes entry');
  }, 120_000);

  it('reads the importer again when a package directory appears beside the configuration, and when its source is edited', async () => {
    const { root, rebuilds, after } = await watching();
    expect(rebuilds).toHaveLength(1);
    expect(rowsOf(graphOf(rebuilds[0] as BuildResult, 'loans-api'), 'module-not-installed')).toContain(
      '@acme/feature-flags',
    );

    addFlagsLibrary(root);
    const appeared = await after('addDir', 'flags-lib');
    expect(appeared).toHaveLength(1);
    expect(appeared[0]?.plan['loans-api']).toEqual({
      mode: 'full',
      reason: 'stand-ins changed: package @acme/feature-flags now at flags-lib',
    });
    expect(appeared[0]?.plan['money-lib']).toEqual({ mode: 'skip', reason: '0 files changed' });
    expect(rowsOf(graphOf(appeared[0] as BuildResult, 'loans-api'), 'package-from-repo')).toContain('@acme/feature-flags');

    // Read from outside every repository, so watched by name from now on.
    appendFileSync(join(root, 'flags-lib/src/index.ts'), 'export const isOff = (name: string): boolean => !name;\n');
    const edited = await after('change', 'flags-lib/src/index.ts');
    expect(edited).toHaveLength(1);
    expect(edited[0]?.plan['loans-api']?.mode).not.toBe('skip');
    expect(edited[0]?.plan['money-lib']).toEqual({ mode: 'skip', reason: '0 files changed' });
  }, 120_000);

  it('reads the importer again when a shape file is added beside the configuration, and when it is edited', async () => {
    const { root, after } = await watching();
    write(root, 'flowatlas-shapes/acme-feature-flags.d.ts', FLAGS_SHAPE);
    const added = await after('add', 'flowatlas-shapes/acme-feature-flags.d.ts');
    expect(added.map((result) => result.plan['loans-api'])).toEqual([
      { mode: 'full', reason: 'stand-ins changed: shape file flowatlas-shapes/acme-feature-flags.d.ts added' },
    ]);

    appendFileSync(join(root, 'flowatlas-shapes/acme-feature-flags.d.ts'), '\n');
    const edited = await after('change', 'flowatlas-shapes/acme-feature-flags.d.ts');
    expect(edited.map((result) => result.plan['loans-api'])).toEqual([
      { mode: 'full', reason: 'stand-ins changed: shape file flowatlas-shapes/acme-feature-flags.d.ts changed' },
    ]);
  }, 120_000);

  it('does not rebuild for what nothing stands in for', async () => {
    const { root, after } = await watching();
    write(root, 'notes.md', '# notes\n');
    expect(await after('add', 'notes.md')).toEqual([]);
    write(root, 'flowatlas-shapes/readme.md', 'not a shape\n');
    expect(await after('add', 'flowatlas-shapes/readme.md')).toEqual([]);
    write(root, 'flags-lib/src/index.ts', 'export const isOn = true;\n');
    expect(await after('add', 'flags-lib/src/index.ts')).toEqual([]);
  }, 120_000);

  it('watches a repository again after it went away and came back', async () => {
    const { root, printed, fake, after } = await watching();
    const repoDir = join(root, 'money-lib');
    const parked = join(root, '.parked-money-lib');
    expect(fake.opened(repoDir)).toBe(1);

    renameSync(repoDir, parked);
    expect(await after('unlinkDir', 'money-lib')).toEqual([]);
    expect(printed.at(-1)).toContain('money-lib is not a directory');

    renameSync(parked, repoDir);
    const back = await after('addDir', 'money-lib');
    expect(back).toHaveLength(1);
    expect(back[0]?.failed).toBe(false);
    expect(fake.opened(repoDir)).toBe(2);

    appendFileSync(join(repoDir, 'src/format.ts'), 'export const formatCents = (cents: number): string => `${cents}`;\n');
    const edited = await after('change', 'money-lib/src/format.ts');
    expect(edited).toHaveLength(1);
    expect(edited[0]?.plan['money-lib']?.mode).not.toBe('skip');
  }, 120_000);

  it('follows an edit to its configuration (P219)', async () => {
    const { root, printed, fake, after } = await watching();
    const configPath = join(root, 'flowatlas.config.json');
    const original = readFileSync(configPath, 'utf8');
    const moneyLib = join(root, 'money-lib');
    expect(fake.open(moneyLib)).toBe(1);

    const raw = JSON.parse(original) as { services: Array<{ name: string }> };
    write(root, 'flowatlas.config.json', { ...raw, services: raw.services.filter((service) => service.name !== 'money-lib') });
    const dropped = await after('change', 'flowatlas.config.json');
    expect(dropped).toHaveLength(1);
    expect(Object.keys(dropped[0]?.plan ?? {})).toEqual(['loans-api']);
    expect(fake.open(moneyLib)).toBe(0);

    // One that does not load is the build's to say, and the watch goes on.
    writeFileSync(configPath, '{ "services": [');
    expect(await after('change', 'flowatlas.config.json')).toEqual([]);
    expect(printed.at(-1)).toContain('not valid JSON');

    writeFileSync(configPath, original);
    const back = await after('change', 'flowatlas.config.json');
    expect(back).toHaveLength(1);
    expect(Object.keys(back[0]?.plan ?? {}).sort()).toEqual(['loans-api', 'money-lib']);
    expect(fake.open(moneyLib)).toBe(1);
    expect(fake.opened(moneyLib)).toBe(2);

    appendFileSync(join(moneyLib, 'src/format.ts'), 'export const formatCents = (cents: number): string => `${cents}`;\n');
    const edited = await after('change', 'money-lib/src/format.ts');
    expect(edited.map((result) => result.plan['money-lib']?.mode)).not.toContain('skip');
  }, 120_000);

  it('mounts a package directory that appears beside the configuration, with chokidar listening', async () => {
    const root = copyOfFixture();
    const rebuilds: BuildResult[] = [];
    handle = await watchProject({
      config: join(root, 'flowatlas.config.json'),
      builtAt: FIXED,
      debounceMs: 40,
      print: () => {},
      onRebuild: (result) => rebuilds.push(result),
    });
    expect(rebuilds).toHaveLength(1);

    // No save in any repository: the directory appearing is the change.
    addFlagsLibrary(root);
    const until = Date.now() + 60_000;
    const read = (): BuildResult | undefined =>
      rebuilds.slice(1).find((result) => result.plan['loans-api']?.mode === 'full');
    while (read() === undefined && Date.now() < until) await new Promise((done) => setTimeout(done, 50));
    await handle.settled();

    const rebuilt = read();
    expect(rebuilt?.plan['loans-api']?.reason).toBe('stand-ins changed: package @acme/feature-flags now at flags-lib');
    const graph = graphOf(rebuilt as BuildResult, 'loans-api');
    expect(rowsOf(graph, 'package-from-repo')).toContain('@acme/feature-flags');
    expect(rowsOf(graph, 'module-not-installed')).not.toContain('@acme/feature-flags');
  }, 120_000);
});
