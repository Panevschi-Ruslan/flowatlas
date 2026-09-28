import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  allDependencies,
  hasAnyDependency,
  readPackageJson,
  readResolvedPackageJson,
} from './manifest.js';

/**
 * These go through the file system rather than through a fake one, because what
 * is being tested is a layout: which file sits above which directory, and what
 * that means. A fake would have to model the same thing and would then be the
 * thing under test.
 */
const roots: string[] = [];

const tree = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), 'flowatlas-manifest-'));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text, 'utf8');
  }
  return root;
};

const manifest = (value: unknown): string => JSON.stringify(value);

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('readPackageJson', () => {
  it('reads the directory\'s own manifest and widens nothing', () => {
    const root = tree({
      'package.json': manifest({ name: 'root', workspaces: ['api'], dependencies: { left: '1.0.0' } }),
      'api/package.json': manifest({ name: 'api' }),
    });
    const pkg = readPackageJson(join(root, 'api'));
    expect(pkg?.name).toBe('api');
    // The narrow question: what this package says about itself, which is nothing.
    expect(Object.keys(allDependencies(pkg ?? {}))).toEqual([]);
  });
});

describe('readResolvedPackageJson', () => {
  it('reads a manifest that stands alone', () => {
    const root = tree({ 'package.json': manifest({ name: 'solo', dependencies: { left: '1.0.0' } }) });
    expect(readResolvedPackageJson(root)?.name).toBe('solo');
    expect(hasAnyDependency(readResolvedPackageJson(root) ?? {}, ['left'])).toBe(true);
  });

  it('returns nothing where there is no manifest at all', () => {
    const root = tree({ 'package.json': manifest({ name: 'root', workspaces: ['api'] }) });
    mkdirSync(join(root, 'api'), { recursive: true });
    expect(readResolvedPackageJson(join(root, 'api'))).toBeUndefined();
  });

  it('answers for a package with a leaf manifest that declares nothing', () => {
    const root = tree({
      'package.json': manifest({
        name: 'root',
        workspaces: ['packages/*'],
        dependencies: { left: '1.0.0' },
        devDependencies: { right: '2.0.0' },
      }),
      'packages/api/package.json': manifest({ name: 'api', version: '0.0.0' }),
    });
    const pkg = readResolvedPackageJson(join(root, 'packages', 'api'));
    expect(pkg?.name).toBe('api');
    expect(Object.keys(allDependencies(pkg ?? {})).sort()).toEqual(['left', 'right']);
  });

  it('reads the member list out of a workspace file as well as a manifest', () => {
    const root = tree({
      'pnpm-workspace.yaml': 'packages:\n  - server\n  - "client/packages/*"\n\nonlyBuilt:\n  - other\n',
      'package.json': manifest({ name: 'root', dependencies: { left: '1.0.0' } }),
      'server/package.json': manifest({ name: 'server', type: 'module' }),
      'client/packages/player/package.json': manifest({ name: 'player' }),
      'scripts/package.json': manifest({ name: 'scripts' }),
    });
    expect(hasAnyDependency(readResolvedPackageJson(join(root, 'server')) ?? {}, ['left'])).toBe(true);
    expect(
      hasAnyDependency(readResolvedPackageJson(join(root, 'client', 'packages', 'player')) ?? {}, ['left']),
    ).toBe(true);
    // Not a member, so the root's declaration says nothing about it.
    expect(hasAnyDependency(readResolvedPackageJson(join(root, 'scripts')) ?? {}, ['left'])).toBe(false);
  });

  it('leaves a directory the workspace excludes alone', () => {
    const root = tree({
      'package.json': manifest({
        name: 'root',
        workspaces: ['packages/*', '!packages/legacy'],
        dependencies: { left: '1.0.0' },
      }),
      'packages/api/package.json': manifest({ name: 'api' }),
      'packages/legacy/package.json': manifest({ name: 'legacy' }),
    });
    expect(hasAnyDependency(readResolvedPackageJson(join(root, 'packages', 'api')) ?? {}, ['left'])).toBe(true);
    expect(hasAnyDependency(readResolvedPackageJson(join(root, 'packages', 'legacy')) ?? {}, ['left'])).toBe(
      false,
    );
  });

  it('keeps what the package itself declares', () => {
    const root = tree({
      'package.json': manifest({ name: 'root', workspaces: ['api'], dependencies: { left: '1.0.0' } }),
      'api/package.json': manifest({ name: 'api', dependencies: { left: '9.9.9', own: '1.0.0' } }),
    });
    const deps = allDependencies(readResolvedPackageJson(join(root, 'api')) ?? {});
    expect(deps['left']).toBe('9.9.9');
    expect(deps['own']).toBe('1.0.0');
  });

  it('answers for a workspace root out of the packages inside it', () => {
    const root = tree({
      'package.json': manifest({ name: 'monorepo', workspaces: ['app', 'packages/*'] }),
      'app/package.json': manifest({ name: 'app', dependencies: { left: '1.0.0' } }),
      'packages/ui/package.json': manifest({ name: 'ui', dependencies: { right: '2.0.0' } }),
      'unlisted/package.json': manifest({ name: 'unlisted', dependencies: { nowhere: '3.0.0' } }),
    });
    const deps = allDependencies(readResolvedPackageJson(root) ?? {});
    expect(Object.keys(deps).sort()).toEqual(['left', 'right']);
  });

  it('does not walk into installed packages', () => {
    const root = tree({
      'package.json': manifest({ name: 'monorepo', workspaces: ['*'] }),
      'node_modules/planted/package.json': manifest({ name: 'planted', dependencies: { no: '1.0.0' } }),
      'app/package.json': manifest({ name: 'app', dependencies: { yes: '1.0.0' } }),
    });
    expect(Object.keys(allDependencies(readResolvedPackageJson(root) ?? {}))).toEqual(['yes']);
  });

  it('survives a manifest that is not valid JSON, anywhere in the chain', () => {
    const root = tree({
      'package.json': '{ this is not json',
      'api/package.json': manifest({ name: 'api', dependencies: { own: '1.0.0' } }),
    });
    expect(readResolvedPackageJson(root)).toBeUndefined();
    expect(readResolvedPackageJson(join(root, 'api'))?.name).toBe('api');
  });
});
