import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GraphBuilder } from './builder.js';
import { loadConfig } from './config.js';
import { packageNameOf } from './origin.js';
import { createProject, reportTsconfigReach } from './project.js';
import { tsconfigReachOf } from './tsconfig-reach.js';
import { forgetCheckouts, scanRootOf, sharedTopOf, upwardCeilingOf } from './upward-walk.js';
import { boundWalksAt, forgetWorkspaces, installCeilingOf, readingCeilingOf } from './workspace.js';

const made: string[] = [];

/** A directory of files written for one test: `{ 'a/b.json': '{}' }`, a trailing slash for a directory. */
const tree = (files: Record<string, string>): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-narrow-')));
  made.push(dir);
  for (const [path, text] of Object.entries(files)) {
    const at = join(dir, path);
    if (path.endsWith('/')) {
      mkdirSync(at, { recursive: true });
      continue;
    }
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, text);
  }
  return dir;
};

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  forgetCheckouts();
  forgetWorkspaces();
});

describe('a run given a root narrower than its checkout reads no higher (P357)', () => {
  const CHECKOUT = {
    '.git/': '',
    'package.json': '{ "name": "top" }',
    'node_modules/hoisted/package.json': '{ "name": "hoisted", "types": "index.d.ts" }',
    'node_modules/hoisted/index.d.ts': 'export declare const hoisted: number;\n',
    'services/api/src/app.ts': "import { hoisted } from 'hoisted';\nexport const app = hoisted;\n",
    'mono/package.json': '{ "workspaces": ["apps/*"] }',
    'mono/apps/web/package.json': '{ "name": "web" }',
    'mono/apps/web/src/a.ts': '',
  };

  it('bounds a walk at the root it was given, widened to the workspace declaring it, and still resolves an install at the checkout top', () => {
    const dir = tree(CHECKOUT);
    const api = join(dir, 'services', 'api');
    // Given nothing, the checkout's top (P334).
    expect(upwardCeilingOf(join(api, 'src'))).toBe(dir);
    expect(packageNameOf(join(api, 'src', 'app.ts'))).toBe('top');
    boundWalksAt([api, join(dir, 'mono', 'apps', 'web')]);
    expect(upwardCeilingOf(join(api, 'src'))).toBe(api);
    expect(readingCeilingOf(api)).toBe(api);
    expect(packageNameOf(join(api, 'src', 'app.ts'))).toBeNull();
    // A member reads up to the workspace that declares it.
    expect(upwardCeilingOf(join(dir, 'mono', 'apps', 'web', 'src'))).toBe(join(dir, 'mono'));
    // An install at the checkout's top is what the compiler resolves from below it, hoisted or not.
    expect(installCeilingOf(api)).toBe(dir);
    const project = createProject({ rootDir: api });
    const app = project.getSourceFileOrThrow(join(api, 'src', 'app.ts'));
    expect(app.getImportDeclarations()[0]?.getModuleSpecifierSourceFile()?.getBaseName()).toBe('index.d.ts');
  });

  it('is bounded by whatever loads a configuration, and by a project opened with none set', () => {
    const dir = tree({
      ...CHECKOUT,
      'ops/flowatlas.config.json': JSON.stringify({ services: [{ name: 'api', repo: '../services/api' }] }),
    });
    const api = join(dir, 'services', 'api');
    loadConfig(join(dir, 'ops'));
    expect(scanRootOf(join(api, 'src'))).toBe(api);
    expect(upwardCeilingOf(join(dir, 'ops'))).toBe(join(dir, 'ops'));
    boundWalksAt([]);
    expect(upwardCeilingOf(join(api, 'src'))).toBe(dir);
    // A library caller opening a project bounds the walks below its root.
    createProject({ rootDir: api });
    expect(upwardCeilingOf(join(api, 'src'))).toBe(api);
  });

  it('searches for what services share from the top of everything the run reads in the checkout', () => {
    const dir = tree({ ...CHECKOUT, 'services/admin/src/b.ts': '', 'proto/shop.proto': '' });
    const api = join(dir, 'services', 'api');
    boundWalksAt([api]);
    expect(sharedTopOf(join(api, 'src'))).toBe(api);
    boundWalksAt([api, join(dir, 'services', 'admin')]);
    expect(sharedTopOf(join(api, 'src'))).toBe(join(dir, 'services'));
    expect(upwardCeilingOf(join(api, 'src'))).toBe(api);
    boundWalksAt([api, join(dir, 'proto')]);
    expect(sharedTopOf(join(api, 'src'))).toBe(dir);
    // Outside what the run reads, the checkout's top.
    expect(sharedTopOf(join(dir, 'mono'))).toBe(dir);
  });

  it('finds a root a run was given through a link by the path a directory really is, spelled as the directory is', () => {
    const dir = tree({ 'repo/src/a.ts': '', 'repo/package.json': '{ "name": "repo" }' });
    const linked = join(dir, 'linked');
    symlinkSync(join(dir, 'repo'), linked, 'dir');
    boundWalksAt([linked]);
    expect(scanRootOf(join(linked, 'src'))).toBe(linked);
    expect(scanRootOf(join(dir, 'repo', 'src'))).toBe(join(dir, 'repo'));
    expect(scanRootOf(dir)).toBeUndefined();
  });
});

describe('what a tsconfig names above the bound is said (P357)', () => {
  const SERVICE = {
    '.git/': '',
    'tsconfig.base.json': '{ "compilerOptions": { "strict": true } }',
    'shared/x.ts': '',
    'lib/tsconfig.json': '{}',
    'services/api/package.json': '{ "name": "api" }',
    'services/api/node_modules/@acme/tsconfig-inside/tsconfig.json': '{ "compilerOptions": { "strict": true } }',
    'services/api/node_modules/@acme/tsconfig-inside/package.json': '{ "name": "@acme/tsconfig-inside" }',
    'services/api/src/app.ts': 'export const app = 1;\n',
  };

  it('reads a relative extends and a reference above, says an include above unread, and resolves a package from an install inside', () => {
    const dir = tree({
      ...SERVICE,
      'services/api/tsconfig.json': JSON.stringify(
        {
          extends: ['../../tsconfig.base.json', '@acme/tsconfig-inside'],
          include: ['src/**/*', '../../shared/**/*'],
          references: [{ path: '../../lib' }],
        },
        null,
        2,
      ),
    });
    const api = join(dir, 'services', 'api');
    boundWalksAt([api]);
    const reach = tsconfigReachOf(join(api, 'tsconfig.json'), readingCeilingOf(api), installCeilingOf(api));
    expect(reach.map(({ key, written, read, why, line }) => ({ key, written, read, why, line }))).toEqual([
      { key: 'extends', written: '../../tsconfig.base.json', read: true, why: 'above', line: 3 },
      { key: 'include', written: '../../shared/**/*', read: false, why: 'above', line: 8 },
      { key: 'references', written: '../../lib', read: true, why: 'above', line: 12 },
    ]);
    // The same tsconfig read for the whole checkout names nothing above.
    expect(tsconfigReachOf(join(api, 'tsconfig.json'), dir)).toEqual([]);
  });

  it('names a package extended that is installed only above the bound, and writes one row for each', () => {
    const dir = tree({
      'node_modules/@acme/tsconfig-above/tsconfig.json': '{}',
      'node_modules/@acme/tsconfig-above/package.json': '{ "name": "@acme/tsconfig-above" }',
      'repo/.git/': '',
      'repo/src/app.ts': 'export const app = 1;\n',
      'repo/tsconfig.json': JSON.stringify({ extends: '@acme/tsconfig-above', include: ['src'] }),
    });
    const repo = join(dir, 'repo');
    const reach = tsconfigReachOf(join(repo, 'tsconfig.json'), readingCeilingOf(repo), installCeilingOf(repo));
    expect(reach.map(({ key, written, read, why }) => ({ key, written, read, why }))).toEqual([
      { key: 'extends', written: '@acme/tsconfig-above', read: false, why: 'installed-above' },
    ]);
    const project = createProject({ rootDir: repo });
    const builder = new GraphBuilder({ repo: 'repo', generatedAt: 'fixed' });
    const rows = reportTsconfigReach({ project, repoDir: repo, builder });
    expect(rows.map((row) => [row.file, row.line, row.reason, row.level ?? 'action'])).toEqual([
      ['tsconfig.json', 1, 'tsconfig-extends-installed-above', 'action'],
    ]);
    expect(rows[0]?.message).toContain('../node_modules/@acme/tsconfig-above/tsconfig.json');
  });
});
