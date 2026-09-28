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
import { hasDependency, readResolvedPackageJson, suppliedWith } from './adapters/manifest.js';

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

  it("follows the service's own devDependencies and not a member's (R143)", () => {
    const root = makeRoot();
    writePackage(root, { name: 'root', workspaces: ['apps/*', 'packages/*'] });
    const api = writePackage(join(root, 'apps', 'api'), {
      name: 'api',
      dependencies: { '@p/mailer': 'workspace:*' },
      devDependencies: { '@p/e2e': 'workspace:*' },
    });
    const mailer = writePackage(join(root, 'packages', 'mailer'), {
      name: '@p/mailer',
      devDependencies: { '@p/preview': 'workspace:*' },
      peerDependencies: { '@p/peer': 'workspace:*' },
      optionalDependencies: { '@p/optional': 'workspace:*' },
    });
    const e2e = writePackage(join(root, 'packages', 'e2e'), {
      name: '@p/e2e',
      devDependencies: { '@p/fixtures': 'workspace:*' },
    });
    const peer = writePackage(join(root, 'packages', 'peer'), { name: '@p/peer' });
    const optional = writePackage(join(root, 'packages', 'optional'), { name: '@p/optional' });
    writePackage(join(root, 'packages', 'preview'), { name: '@p/preview' });
    writePackage(join(root, 'packages', 'fixtures'), { name: '@p/fixtures' });

    // `preview` is the mailer's devDependency and `fixtures` the e2e helper's:
    // neither is installed for the service, so neither is the service.
    expect(serviceSourceDirs(api)).toEqual([api, e2e, mailer, optional, peer]);
  });

  it('keeps a member reached at run time even when another member reaches it only for development', () => {
    const root = makeRoot();
    writePackage(root, { name: 'root', workspaces: ['apps/*', 'packages/*'] });
    const api = writePackage(join(root, 'apps', 'api'), {
      name: 'api',
      dependencies: { '@p/a': 'workspace:*', '@p/b': 'workspace:*' },
    });
    const a = writePackage(join(root, 'packages', 'a'), {
      name: '@p/a',
      devDependencies: { '@p/shared': 'workspace:*' },
    });
    const b = writePackage(join(root, 'packages', 'b'), {
      name: '@p/b',
      dependencies: { '@p/shared': 'workspace:*' },
    });
    const shared = writePackage(join(root, 'packages', 'shared'), { name: '@p/shared' });
    expect(serviceSourceDirs(api)).toEqual([api, a, b, shared]);
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

/**
 * A workspace shaped like a server whose mail library renders with a view
 * library: the server declares none of it, the mail package installs it, a kit
 * of pieces the templates use takes it as a peer, an SDK takes it as a peer and
 * is depended on by the server alone, and a transport never mentions it (R145).
 */
const renderingServer = (): { root: string; api: string } => {
  const root = makeRoot();
  writePackage(root, { name: 'root', workspaces: ['apps/*', 'packages/*'] });
  const api = writePackage(join(root, 'apps', 'api'), {
    name: '@x/api',
    dependencies: { '@x/mail': '*', '@x/sdk': '*', '@x/transport': '*' },
  });
  writePackage(join(root, 'packages', 'mail'), {
    name: '@x/mail',
    dependencies: { 'view-lib': '^1', '@x/kit': '*', '@x/transport': '*' },
  });
  writePackage(join(root, 'packages', 'kit'), { name: '@x/kit', peerDependencies: { 'view-lib': '^1' } });
  writePackage(join(root, 'packages', 'sdk'), { name: '@x/sdk', peerDependencies: { 'view-lib': '^1' } });
  writePackage(join(root, 'packages', 'transport'), { name: '@x/transport' });
  writePackage(join(root, 'packages', 'tooling'), { name: '@x/tooling', devDependencies: { 'view-lib': '^1' } });
  return { root, api };
};

const declaresViewLib = (pkg: Parameters<typeof hasDependency>[0]): boolean => hasDependency(pkg, 'view-lib');

describe('suppliedWith', () => {
  it('reads a file only where the package holding it is supplied the framework', () => {
    const { root, api } = renderingServer();
    const reads = suppliedWith(api, declaresViewLib);
    expect(reads(join(root, 'packages', 'mail', 'src', 'Receipt.tsx'))).toBe(true);
    // A peer, satisfied by the mail package that depends on it.
    expect(reads(join(root, 'packages', 'kit', 'src', 'Button.tsx'))).toBe(true);
    // A peer whose only dependent is the server, which supplies nothing.
    expect(reads(join(root, 'packages', 'sdk', 'src', 'Provider.tsx'))).toBe(false);
    // Reached through a supplied package, but supplied nothing itself.
    expect(reads(join(root, 'packages', 'transport', 'src', 'index.ts'))).toBe(false);
    expect(reads(join(api, 'src', 'e2e', 'helpers.ts'))).toBe(false);
  });

  it('supplies every file when the service itself declares the framework', () => {
    const { root, api } = renderingServer();
    writePackage(api, { name: '@x/api', dependencies: { 'view-lib': '^1', '@x/transport': '*' } });
    const reads = suppliedWith(api, declaresViewLib);
    expect(reads(join(api, 'src', 'page.tsx'))).toBe(true);
    expect(reads(join(root, 'packages', 'transport', 'src', 'index.ts'))).toBe(true);
  });

  it('reads every file of a directory with no manifest, which has no packages to tell apart', () => {
    const dir = makeRoot();
    expect(suppliedWith(dir, declaresViewLib)(join(dir, 'src', 'page.tsx'))).toBe(true);
  });

  it("takes a member's devDependencies as supplying nothing", () => {
    const root = makeRoot();
    writePackage(root, { name: 'root', workspaces: ['apps/*', 'packages/*'] });
    const api = writePackage(join(root, 'apps', 'api'), { name: '@y/api', dependencies: { '@y/mailer': '*' } });
    writePackage(join(root, 'packages', 'mailer'), { name: '@y/mailer', devDependencies: { 'view-lib': '^1' } });
    expect(suppliedWith(api, declaresViewLib)(join(root, 'packages', 'mailer', 'src', 'Preview.tsx'))).toBe(false);
  });
});

describe('readResolvedPackageJson and the extent agree on a member (R145)', () => {
  it("widens by a member's runtime sections and not by its devDependencies", () => {
    const root = makeRoot();
    writePackage(root, { name: 'root', workspaces: ['apps/*', 'packages/*'] });
    const api = writePackage(join(root, 'apps', 'api'), {
      name: '@z/api',
      dependencies: { '@z/mailer': '*' },
      devDependencies: { 'own-test-lib': '^1' },
    });
    writePackage(join(root, 'packages', 'mailer'), {
      name: '@z/mailer',
      dependencies: { 'smtp-lib': '^1' },
      peerDependencies: { 'shared-runtime': '^1' },
      devDependencies: { 'view-lib': '^1' },
    });
    const widened = readResolvedPackageJson(api) ?? {};
    expect(hasDependency(widened, 'smtp-lib')).toBe(true);
    expect(hasDependency(widened, 'shared-runtime')).toBe(true);
    expect(hasDependency(widened, 'own-test-lib')).toBe(true);
    expect(hasDependency(widened, 'view-lib')).toBe(false);
  });
});
