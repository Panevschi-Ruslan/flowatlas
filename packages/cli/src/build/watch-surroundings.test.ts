import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { isWithinDir, parseConfig, toPosixPath, type FlowatlasConfig, type ServiceConfig } from '@flowatlas/core';
import { afterAll, describe, expect, it } from 'vitest';
import type { BuildCache } from './cache.js';
import { isIgnored } from './watch.js';
import { admits, mattersTo, rootsOf, surroundingsOf, watchingLine, type WatchTarget } from './watch-surroundings.js';

/**
 * What a watch looks at beside the repositories (P206), worked out from a
 * configuration and a disk laid out by hand: no watcher runs here, so nothing
 * waits on a kernel.
 */

const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-watch-surroundings-')));
let made = 0;

afterAll(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const write = (root: string, path: string, body: unknown = ''): void => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof body === 'string' ? body : JSON.stringify(body));
};

interface Project {
  root: string;
  config: FlowatlasConfig;
  targets: (cache?: BuildCache) => WatchTarget[];
}

/** A project with a `shop-api` repository and whatever else the case lays out. */
const project = (raw: Record<string, unknown>, files: Record<string, unknown> = {}): Project => {
  const root = join(scratch, `project-${(made += 1)}`);
  write(root, 'shop-api/package.json', { name: 'shop-api' });
  write(root, 'shop-api/src/main.ts');
  for (const [path, body] of Object.entries(files)) write(root, path, body);
  const config = parseConfig({ services: [{ name: 'shop-api', repo: './shop-api', type: 'nestjs' }], ...raw });
  const repoDirOf = (service: ServiceConfig): string => join(root, service.repo);
  const outputDir = join(root, config.output);
  const seenByRepository = (path: string): boolean =>
    config.services.some((service) => isWithinDir(path, repoDirOf(service)) && !isIgnored(repoDirOf(service), path, outputDir));
  return {
    root,
    config,
    targets: (cache) => surroundingsOf({ config, rootDir: root, repoDirOf, outputDir, seenByRepository, cache }),
  };
};

const at = (root: string, path: string): string => join(root, ...path.split('/'));

const of = (targets: readonly WatchTarget[], kind: WatchTarget['kind']): WatchTarget[] =>
  targets.filter((target) => target.kind === kind);

describe('the directories beside the configuration', () => {
  it('watches each one coming and going and the manifest at the top of it, nothing deeper', () => {
    const { root, targets } = project({}, { 'flags-lib/package.json': { name: '@acme/flags' } });
    const found = targets();
    expect(of(found, 'folders').map((target) => target.dir)).toEqual([root]);

    expect(mattersTo(found, 'addDir', at(root, 'ledger-lib'))).toContain('folders');
    expect(mattersTo(found, 'unlinkDir', at(root, 'flags-lib'))).toContain('folders');
    expect(mattersTo(found, 'change', at(root, 'flags-lib/package.json'))).toContain('folders');
    expect(mattersTo(found, 'add', at(root, 'pnpm-workspace.yaml'))).toContain('folders');
    expect(mattersTo(found, 'add', at(root, 'package.json'))).toContain('folders');

    // A file at the top that no package index reads, a file inside a package,
    // and directories the index never takes for a package.
    expect(mattersTo(found, 'change', at(root, 'notes.md'))).toEqual([]);
    expect(mattersTo(found, 'add', at(root, 'flags-lib/src/index.ts'))).toEqual([]);
    expect(mattersTo(found, 'addDir', at(root, 'node_modules'))).toEqual([]);
    expect(mattersTo(found, 'addDir', at(root, '.cache'))).toEqual([]);
    expect(mattersTo(found, 'addDir', at(root, 'dist'))).toEqual([]);

    // Walked one level and no further: a tree appearing costs one listing.
    expect(admits(found, at(root, 'flags-lib'), 'dir')).toBe(true);
    expect(admits(found, at(root, 'flags-lib/src'), 'dir')).toBe(false);
    expect(admits(found, at(root, 'flags-lib/package.json'), 'file')).toBe(true);
  });

  it('leaves out the output, even when it is not a dot directory', () => {
    const { root, targets } = project({ output: 'out' });
    expect(mattersTo(targets(), 'addDir', at(root, 'out'))).toEqual([]);
    expect(mattersTo(targets(), 'add', at(root, 'out/package.json'))).toEqual([]);
  });

  it('is not watched when no service reads package sources from there', () => {
    const off = project({ packageSources: 'services' });
    expect(of(off.targets(), 'folders')).toEqual([]);
    expect(of(project({ packageSources: false }).targets(), 'folders')).toEqual([]);
  });
});

describe('a workspace kept beside the configuration', () => {
  it("watches its members' directory, each member and its manifest", () => {
    const { root, targets } = project(
      {},
      {
        'libs/package.json': { name: 'libs', workspaces: ['packages/*'] },
        'libs/packages/flags/package.json': { name: '@acme/flags' },
      },
    );
    const found = of(targets(), 'workspace');
    expect(found.map((target) => toPosixPath(target.dir))).toEqual([toPosixPath(at(root, 'libs/packages'))]);
    expect(mattersTo(found, 'addDir', at(root, 'libs/packages/ledger'))).toEqual(['workspace']);
    expect(mattersTo(found, 'add', at(root, 'libs/packages/ledger/package.json'))).toEqual(['workspace']);
    expect(mattersTo(found, 'add', at(root, 'libs/packages/ledger/src/index.ts'))).toEqual([]);
    expect(admits(found, at(root, 'libs/packages/ledger/src'), 'dir')).toBe(false);
  });

  it('is watched from where its members would appear when their directory is not there yet', () => {
    const { root, targets } = project({}, { 'pnpm-workspace.yaml': 'packages:\n  - "modules/*"\n' });
    const found = of(targets(), 'workspace');
    expect(found.map((target) => target.dir)).toEqual([root]);
    expect(mattersTo(found, 'addDir', at(root, 'modules'))).toEqual(['workspace']);
    expect(mattersTo(found, 'add', at(root, 'modules/flags/package.json'))).toEqual(['workspace']);
    expect(mattersTo(found, 'addDir', at(root, 'elsewhere'))).toEqual([]);
  });
});

describe('the shape and pattern files the configuration lists', () => {
  it('watches a glob from its directory', () => {
    const { root, targets } = project({ shapes: ['./flowatlas-shapes/*.d.ts'] }, { 'flowatlas-shapes/queue.d.ts': '' });
    const found = of(targets(), 'shapes');
    expect(found.map((target) => toPosixPath(target.dir))).toEqual([toPosixPath(at(root, 'flowatlas-shapes'))]);
    expect(mattersTo(found, 'add', at(root, 'flowatlas-shapes/flags.d.ts'))).toEqual(['shapes']);
    expect(mattersTo(found, 'change', at(root, 'flowatlas-shapes/queue.d.ts'))).toEqual(['shapes']);
    expect(mattersTo(found, 'add', at(root, 'flowatlas-shapes/readme.md'))).toEqual([]);
  });

  it('watches a glob whose directory is not there yet from the deepest one that is', () => {
    const { root, targets } = project({ shapes: ['types/shapes/**/*.d.ts'] });
    const found = of(targets(), 'shapes');
    expect(found.map((target) => target.dir)).toEqual([root]);
    expect(mattersTo(found, 'addDir', at(root, 'types'))).toEqual(['shapes']);
    expect(mattersTo(found, 'addDir', at(root, 'types/shapes/a/b'))).toEqual(['shapes']);
    expect(mattersTo(found, 'add', at(root, 'types/shapes/a/flags.d.ts'))).toEqual(['shapes']);
    expect(mattersTo(found, 'addDir', at(root, 'types/shapes/node_modules'))).toEqual([]);
    expect(mattersTo(found, 'addDir', at(root, 'other'))).toEqual([]);
  });

  it('watches a plain path, a service entry and a patterns entry', () => {
    const { root, config, targets } = project(
      { patterns: ['flowatlas-patterns/*.yml'] },
      { 'flowatlas-patterns/house.yml': '' },
    );
    config.services[0] = { ...(config.services[0] as ServiceConfig), shapes: ['shapes/flags.d.ts'] };
    const found = targets();
    expect(mattersTo(found, 'add', at(root, 'shapes/flags.d.ts'))).toEqual(['shapes']);
    expect(mattersTo(found, 'add', at(root, 'shapes/other.d.ts'))).toEqual([]);
    expect(mattersTo(found, 'unlink', at(root, 'flowatlas-patterns/house.yml'))).toEqual(['patterns']);
  });

  it('leaves a glob inside a repository to its watch, unless that watch would leave it out', () => {
    const inside = project({ shapes: ['shop-api/types/*.d.ts'] }, { 'shop-api/types/a.d.ts': '' });
    expect(of(inside.targets(), 'shapes')).toEqual([]);
    const dotted = project({ shapes: ['shop-api/.shapes/*.d.ts'] });
    expect(mattersTo(of(dotted.targets(), 'shapes'), 'add', at(dotted.root, 'shop-api/.shapes/a.d.ts'))).toEqual([
      'shapes',
    ]);
  });
});

describe('files a reading read from outside every repository', () => {
  it("watches each by name, and neither an installed package's files nor a repository's", () => {
    const { root, targets } = project(
      { packageSources: 'services' },
      { 'flags-lib/package.json': { name: '@acme/flags' }, 'flags-lib/src/index.ts': '' },
    );
    const stamp = { hash: 'sha1:0', size: 0, mtimeMs: 0, deps: [] };
    const cache = {
      repos: {
        'shop-api': {
          packages: {
            '../flags-lib/package.json': stamp,
            '../flags-lib/src/index.ts': stamp,
            'node_modules/@types/node/index.d.ts': stamp,
            'src/local.d.ts': stamp,
          },
        },
      },
    } as unknown as BuildCache;
    const found = of(targets(cache), 'sources');
    expect(found.map((target) => toPosixPath(target.dir)).sort()).toEqual(
      [toPosixPath(at(root, 'flags-lib')), toPosixPath(at(root, 'flags-lib/src'))].sort(),
    );
    expect(mattersTo(found, 'change', at(root, 'flags-lib/src/index.ts'))).toEqual(['sources']);
    expect(mattersTo(found, 'add', at(root, 'flags-lib/src/other.ts'))).toEqual([]);
    expect(watchingLine(1, found)).toBe('watching 1 repository and 2 files read from outside them');
  });
});

describe('where each repository is', () => {
  it('watches the repository in its parent and nothing else there', () => {
    const { root, targets } = project({ packageSources: false });
    const found = targets();
    expect(of(found, 'repository').map((target) => target.dir)).toEqual([root]);
    expect(mattersTo(found, 'addDir', at(root, 'shop-api'))).toEqual(['repository']);
    expect(mattersTo(found, 'unlinkDir', at(root, 'shop-api'))).toEqual(['repository']);
    expect(mattersTo(found, 'addDir', at(root, 'shop-web'))).toEqual([]);
    expect(admits(found, at(root, 'shop-api/src'), 'dir')).toBe(false);
    expect(rootsOf(found)).toEqual([root]);
  });
});

describe('the configuration file (P219)', () => {
  it('is watched by name, and nothing else at the top for it', () => {
    const { root, config } = project({ packageSources: false });
    const configPath = join(root, 'flowatlas.config.json');
    const found = surroundingsOf({
      config,
      configPath,
      rootDir: root,
      repoDirOf: (service) => join(root, service.repo),
      outputDir: join(root, config.output),
      seenByRepository: () => false,
    });
    expect(mattersTo(found, 'change', configPath)).toEqual(['configuration']);
    expect(mattersTo(found, 'change', at(root, 'flowatlas.config.json.bak'))).toEqual([]);
    expect(watchingLine(1, found)).toBe('watching 1 repository');
  });
});

describe('the line that says what is watched', () => {
  it('names what is watched beside the repositories', () => {
    const { targets } = project(
      { shapes: ['flowatlas-shapes/*.d.ts'], patterns: ['flowatlas-patterns/*.yml'] },
      { 'pnpm-workspace.yaml': 'packages:\n  - "libs/*"\n' },
    );
    expect(watchingLine(1, targets())).toBe(
      'watching 1 repository, the directories beside the configuration, 1 workspace glob, 1 shapes entry and 1 patterns entry',
    );
    expect(watchingLine(2, [])).toBe('watching 2 repositories');
  });
});
