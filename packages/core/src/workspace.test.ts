import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isServiceSource,
  serviceSourceDirs,
  workspaceGlobs,
  workspaceMemberDirs,
  workspacePackages,
  workspaceRootOf,
  workspaceRootsAbove,
} from './workspace.js';
import { readResolvedPackageJson } from './adapters/manifest.js';

const temporary: string[] = [];

const makeRoot = (): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-workspace-')));
  temporary.push(dir);
  return dir;
};

const writePackage = (dir: string, pkg: Record<string, unknown>): string => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
  return dir;
};

afterEach(() => {
  while (temporary.length > 0) {
    const dir = temporary.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

describe('workspaceGlobs', () => {
  it('reads the manifest field', () => {
    const root = makeRoot();
    writePackage(root, { name: 'root', workspaces: ['apps/*', 'packages/*'] });
    expect(workspaceGlobs(root)).toEqual(['apps/*', 'packages/*']);
  });

  it('reads the field in its object spelling', () => {
    const root = makeRoot();
    writePackage(root, { name: 'root', workspaces: { packages: ['apps/*'] } });
    expect(workspaceGlobs(root)).toEqual(['apps/*']);
  });

  it('reads the pnpm file, and stops at the next key', () => {
    const root = makeRoot();
    writePackage(root, { name: 'root' });
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      ["packages:", "  - 'apps/*'", '  - server', '', 'onlyBuiltDependencies:', '  - esbuild', ''].join('\n'),
    );
    expect(workspaceGlobs(root)).toEqual(['apps/*', 'server']);
  });


  it('reads the list written inline, and the comments around it', () => {
    const root = makeRoot();
    writePackage(root, { name: 'root' });
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      ['# what this repository is made of', 'packages: ["apps/*", \'packages/*\']', ''].join('\n'),
    );
    expect(workspaceGlobs(root)).toEqual(['apps/*', 'packages/*']);
  });

  it('keeps an item written with a trailing comment', () => {
    const root = makeRoot();
    writePackage(root, { name: 'root' });
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      ['packages:', '  - apps/*   # every application', '  # and nothing else yet', ''].join('\n'),
    );
    expect(workspaceGlobs(root)).toEqual(['apps/*']);
  });

  it('says nothing for a directory that declares no workspace', () => {
    const root = makeRoot();
    writePackage(root, { name: 'plain' });
    expect(workspaceGlobs(root)).toEqual([]);
  });
});

describe('workspacePackages', () => {
  it('finds members by glob and skips a matched directory with no manifest', () => {
    const root = makeRoot();
    writePackage(root, { name: 'root', workspaces: ['apps/*', 'packages/*'] });
    writePackage(join(root, 'apps', 'web'), { name: '@p/web' });
    writePackage(join(root, 'packages', 'lib'), { name: '@p/lib' });
    mkdirSync(join(root, 'packages', 'not-a-package'), { recursive: true });

    expect(workspacePackages(root).map((pkg) => pkg.name).sort()).toEqual(['@p/lib', '@p/web']);
  });

  it('honours a negated glob', () => {
    const root = makeRoot();
    writePackage(root, { name: 'root', workspaces: ['packages/*', '!packages/private'] });
    writePackage(join(root, 'packages', 'lib'), { name: '@p/lib' });
    writePackage(join(root, 'packages', 'private'), { name: '@p/private' });

    expect(workspacePackages(root).map((pkg) => pkg.name)).toEqual(['@p/lib']);
  });

  it('never looks inside node_modules', () => {
    const root = makeRoot();
    writePackage(root, { name: 'root', workspaces: ['**'] });
    writePackage(join(root, 'node_modules', 'left-over'), { name: 'left-over' });
    expect(workspacePackages(root).map((pkg) => pkg.name)).toEqual([]);
  });
});

describe('workspaceRootOf', () => {
  it('finds the workspace a directory is a member of', () => {
    const root = makeRoot();
    writePackage(root, { name: 'root', workspaces: ['apps/*'] });
    const web = writePackage(join(root, 'apps', 'web'), { name: 'web' });
    expect(workspaceRootOf(web)).toBe(root);
  });

  it('answers with the nearest workspace that lists it', () => {
    const root = makeRoot();
    writePackage(root, { name: 'root', workspaces: ['client', 'client/packages/*'] });
    const client = writePackage(join(root, 'client'), { name: 'client', workspaces: ['packages/*'] });
    const inner = writePackage(join(client, 'packages', 'player'), { name: 'player' });
    expect(workspaceRootOf(inner)).toBe(client);
    expect(workspaceRootOf(client)).toBe(root);
  });

  it('says nothing for a workspace root itself', () => {
    const root = makeRoot();
    writePackage(root, { name: 'root', workspaces: ['apps/*'] });
    expect(workspaceRootOf(root)).toBeUndefined();
  });
});

describe('serviceSourceDirs', () => {
  it('gives a plain directory nothing but itself', () => {
    const root = makeRoot();
    const plain = writePackage(join(root, 'orders'), { name: 'orders' });
    expect(serviceSourceDirs(plain)).toEqual([plain]);
  });

  it('adds the workspace packages the service declares, and theirs in turn', () => {
    const root = makeRoot();
    writePackage(root, { name: 'root', workspaces: ['apps/*', 'packages/*'] });
    const web = writePackage(join(root, 'apps', 'web'), {
      name: 'web',
      dependencies: { '@p/lib': 'workspace:*', next: '^15.0.0' },
    });
    const lib = writePackage(join(root, 'packages', 'lib'), {
      name: '@p/lib',
      dependencies: { '@p/store': 'workspace:*' },
    });
    const store = writePackage(join(root, 'packages', 'store'), { name: '@p/store' });
    writePackage(join(root, 'packages', 'unused'), { name: '@p/unused' });

    expect(serviceSourceDirs(web)).toEqual([web, lib, store]);
  });

  it('keeps the service directory first, whatever the names sort to', () => {
    const root = makeRoot();
    writePackage(root, { name: 'root', workspaces: ['*'] });
    const zulu = writePackage(join(root, 'zulu'), { name: 'zulu', dependencies: { alpha: '*' } });
    const alpha = writePackage(join(root, 'alpha'), { name: 'alpha' });
    expect(serviceSourceDirs(zulu)).toEqual([zulu, alpha]);
  });

  it('refuses a member that contains the service', () => {
    const root = makeRoot();
    writePackage(root, { name: 'whole', workspaces: ['.', 'apps/*'] });
    const web = writePackage(join(root, 'apps', 'web'), {
      name: 'web',
      dependencies: { whole: 'workspace:*' },
    });
    expect(serviceSourceDirs(web)).toEqual([web]);
  });

  it('gives a workspace root itself nothing but itself', () => {
    const root = makeRoot();
    writePackage(root, { name: 'root', workspaces: ['packages/*'] });
    writePackage(join(root, 'packages', 'lib'), { name: '@p/lib' });
    expect(serviceSourceDirs(root)).toEqual([root]);
  });
});

describe('isServiceSource', () => {
  it('accepts a file of a declared workspace package and refuses an installed one', () => {
    const root = makeRoot();
    writePackage(root, { name: 'root', workspaces: ['apps/*', 'packages/*'] });
    const web = writePackage(join(root, 'apps', 'web'), {
      name: 'web',
      dependencies: { '@p/lib': 'workspace:*' },
    });
    const lib = writePackage(join(root, 'packages', 'lib'), { name: '@p/lib' });

    expect(isServiceSource(join(web, 'app', 'route.ts'), web)).toBe(true);
    expect(isServiceSource(join(lib, 'src', 'index.ts'), web)).toBe(true);
    expect(isServiceSource(join(web, 'node_modules', '@p', 'lib', 'index.d.ts'), web)).toBe(false);
    expect(isServiceSource(join(root, 'packages', 'other', 'x.ts'), web)).toBe(false);
  });
});

/**
 * The seam R115 closed: the extent and the manifest chain are two questions, and
 * they are answered from one glob set, one matcher and one walk.
 */
describe('one discoverer', () => {
  it('counts a nameless member of the workspace without making it a package', () => {
    const root = makeRoot();
    writePackage(root, { name: 'root', workspaces: ['packages/*'] });
    writePackage(join(root, 'packages/tools'), { dependencies: { 'pkg-tools': '4.0.0' } });
    writePackage(join(root, 'packages/lib'), { name: 'lib' });

    // A directory of source files with nothing to import it by is not a package,
    // and what it declares still governs the files inside it.
    expect(workspacePackages(root).map((pkg) => pkg.name)).toEqual(['lib']);
    expect(workspaceMemberDirs(root)).toContain(join(root, 'packages/tools'));
    expect(readResolvedPackageJson(root)?.dependencies?.['pkg-tools']).toBe('4.0.0');
  });

  it('never walks into a build output, whichever question is asked', () => {
    const root = makeRoot();
    writePackage(root, { name: 'root', workspaces: ['**'] });
    writePackage(join(root, 'dist/web'), { name: 'built-copy', dependencies: { 'pkg-built': '18.0.0' } });
    writePackage(join(root, 'apps/web'), { name: 'web' });

    expect(workspacePackages(root).map((pkg) => pkg.name)).toEqual(['web']);
    expect(readResolvedPackageJson(root)?.dependencies?.['pkg-built']).toBeUndefined();
    expect(workspaceRootsAbove(join(root, 'dist/web'))).toEqual([]);
  });

  it('answers the chain from every root above and the extent from the nearest', () => {
    const root = makeRoot();
    writePackage(root, { name: 'outer', workspaces: ['group/*', 'group/*/*'], dependencies: { 'pkg-outer': '10.0.0' } });
    writePackage(join(root, 'group/inner'), { name: 'inner', workspaces: ['*'], dependencies: { 'pkg-inner': '2.0.0' } });
    writePackage(join(root, 'group/inner/api'), { name: 'api' });

    const api = join(root, 'group/inner/api');
    expect(workspaceRootsAbove(api)).toEqual([join(root, 'group/inner'), root]);
    expect(workspaceRootOf(api)).toBe(join(root, 'group/inner'));
    const resolved = readResolvedPackageJson(api);
    expect(resolved?.dependencies?.['pkg-inner']).toBe('2.0.0');
    expect(resolved?.dependencies?.['pkg-outer']).toBe('10.0.0');
  });
});
