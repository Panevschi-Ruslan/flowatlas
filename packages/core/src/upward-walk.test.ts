import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packageNameOf } from './origin.js';
import { createProject, sourceRootsOf } from './project.js';
import { checkoutTopOf, forgetCheckouts, isNoRepositoryDir, mayClimbTo, upwardCeilingOf } from './upward-walk.js';
import { boundWalksAt, forgetWorkspaces, scanCeilingOf, workspaceRootsAbove } from './workspace.js';

const made: string[] = [];

/** A directory of files written for one test: `{ 'a/b.json': '{}' }`, a trailing slash for a directory. */
const tree = (files: Record<string, string>): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'flowatlas-upward-')));
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

describe('upward walks stop at the repository (P334)', () => {
  it('finds the top of the checkout a directory is in, a clone or a worktree, never the home directory or the root', () => {
    const dir = tree({ 'clone/.git/': '', 'clone/src/app/': '', 'worktree/.git': 'gitdir: elsewhere\n', 'worktree/src/': '', 'loose/src/': '' });
    expect(checkoutTopOf(join(dir, 'clone/src/app'))).toBe(join(dir, 'clone'));
    expect(checkoutTopOf(join(dir, 'worktree/src'))).toBe(join(dir, 'worktree'));
    expect(checkoutTopOf(join(dir, 'loose/src'))).toBeUndefined();
    expect(isNoRepositoryDir(parse(dir).root)).toBe(true);
    expect(isNoRepositoryDir(homedir())).toBe(true);
    expect(isNoRepositoryDir(dir)).toBe(false);
    // Bounded by the checkout; with none, anywhere but the home directory and the root.
    const ceiling = upwardCeilingOf(join(dir, 'clone/src/app'));
    expect(mayClimbTo(join(dir, 'clone/src'), ceiling)).toBe(true);
    expect(mayClimbTo(dir, ceiling)).toBe(false);
    expect(mayClimbTo(dir, undefined)).toBe(true);
    expect(mayClimbTo(homedir(), undefined)).toBe(false);
    expect(mayClimbTo(parse(dir).root, undefined)).toBe(false);
  });

  it('reads no workspace above the checkout a member is in, and widens a given root to the workspace declaring it', () => {
    const files = { 'package.json': '{ "workspaces": ["inner/packages/*"] }', 'inner/packages/a/package.json': '{ "name": "a" }' };
    const loose = tree(files);
    expect(workspaceRootsAbove(join(loose, 'inner/packages/a'))).toEqual([loose]);
    expect(scanCeilingOf(join(loose, 'inner/packages/a'))).toBe(loose);
    const checkout = tree({ ...files, 'inner/.git/': '' });
    expect(workspaceRootsAbove(join(checkout, 'inner/packages/a'))).toEqual([]);
    expect(scanCeilingOf(join(checkout, 'inner/packages/a'))).toBe(join(checkout, 'inner/packages/a'));
    // A workspace inside the checkout is still found.
    const inside = tree({ 'inner/package.json': '{ "workspaces": ["packages/*"] }', 'inner/packages/a/package.json': '{ "name": "a" }', 'inner/.git/': '' });
    expect(workspaceRootsAbove(join(inside, 'inner/packages/a'))).toEqual([join(inside, 'inner')]);
    expect(scanCeilingOf(join(inside, 'inner/packages/a'))).toBe(join(inside, 'inner'));
  });

  it('names no file by the package of a manifest outside the checkout it is in', () => {
    const dir = tree({ 'package.json': '{ "name": "outside" }', 'clone/.git/': '', 'clone/src/a.ts': '', 'loose/src/b.ts': '' });
    expect(packageNameOf(join(dir, 'clone/src/a.ts'))).toBeNull();
    expect(packageNameOf(join(dir, 'loose/src/b.ts'))).toBe('outside');
  });

  it('follows no tsconfig extends out of the checkout a service is in', () => {
    const files = { 'base.json': '{ "include": ["clone/lib"] }', 'clone/tsconfig.json': `{ "extends": "${['..', 'base.json'].join('/')}" }`, 'clone/lib/a.ts': '' };
    const loose = tree(files);
    expect(sourceRootsOf(join(loose, 'clone'))).toEqual(['lib']);
    const checkout = tree({ ...files, 'clone/.git/': '' });
    expect(sourceRootsOf(join(checkout, 'clone'))).toEqual(['.']);
  });
});

describe('walks and installs bounded by what a run reads (P340)', () => {
  /** A repository whose source imports a package installed above it and one installed in it. */
  const DECOY = {
    'node_modules/decoy/package.json': '{ "name": "decoy", "types": "index.d.ts" }',
    'node_modules/decoy/index.d.ts': 'export declare const decoy: number;\n',
    'node_modules/@types/stray/index.d.ts': 'declare const stray: string;\n',
    'node_modules/@types/stray/package.json': '{ "name": "@types/stray" }',
    'repo/package.json': '{ "name": "repo" }',
    'repo/src/app.ts': '/// <reference types="stray" />\n' + "import { decoy } from 'decoy';\nimport { kept } from 'kept';\nexport const both = [decoy, kept];\n",
    'repo/node_modules/kept/package.json': '{ "name": "kept", "types": "index.d.ts" }',
    'repo/node_modules/kept/index.d.ts': 'export declare const kept: number;\n',
  };

  const resolvedOf = (root: string): { imports: (string | undefined)[]; stray: boolean } => {
    const project = createProject({ rootDir: root });
    const app = project.getSourceFileOrThrow(join(root, 'src', 'app.ts'));
    const imports = app.getImportDeclarations().map((each) => each.getModuleSpecifierSourceFile()?.getBaseName());
    const stray = project
      .getProgram()
      .compilerObject.getSourceFiles()
      .some((file) => file.fileName.includes('@types/stray'));
    return { imports, stray };
  };

  it('resolves no import and reads no types from an install above the checkout, and an install inside it as before', () => {
    const dir = tree({ ...DECOY, 'repo/.git/': '' });
    expect(resolvedOf(join(dir, 'repo'))).toEqual({ imports: [undefined, 'index.d.ts'], stray: false });
  });

  it('bounds a service in no checkout by what the run was asked to read', () => {
    const dir = tree(DECOY);
    const root = join(dir, 'repo');
    // Given nothing, the service itself.
    expect(resolvedOf(root)).toEqual({ imports: [undefined, 'index.d.ts'], stray: false });
    boundWalksAt([root]);
    expect(upwardCeilingOf(join(root, 'src'))).toBe(root);
    expect(packageNameOf(join(root, 'src', 'app.ts'))).toBe('repo');
    expect(resolvedOf(root)).toEqual({ imports: [undefined, 'index.d.ts'], stray: false });
    // A run asked to read the directory above reads its install.
    boundWalksAt([dir, root]);
    expect(upwardCeilingOf(join(root, 'src'))).toBe(dir);
    expect(resolvedOf(root)).toEqual({ imports: ['index.d.ts', 'index.d.ts'], stray: true });
  });

  it('widens a root the run was given to the workspace declaring it, and reads no manifest above that', () => {
    const dir = tree({
      'package.json': '{ "name": "outside" }',
      'mono/package.json': '{ "workspaces": ["apps/*"] }',
      'mono/apps/api/src/a.ts': '',
      'mono/apps/api/package.json': '{ "name": "api" }',
      'mono/tools/b.ts': '',
    });
    boundWalksAt([join(dir, 'mono', 'apps', 'api')]);
    expect(upwardCeilingOf(join(dir, 'mono', 'apps', 'api', 'src'))).toBe(join(dir, 'mono'));
    expect(workspaceRootsAbove(join(dir, 'mono', 'apps', 'api'))).toEqual([join(dir, 'mono')]);
    expect(upwardCeilingOf(join(dir, 'mono', 'tools'))).toBe(join(dir, 'mono'));
    expect(mayClimbTo(dir, upwardCeilingOf(join(dir, 'mono', 'tools')))).toBe(false);
    // Outside every root the run reads, a walk is bounded as before (P334).
    expect(upwardCeilingOf(dir)).toBeUndefined();
    boundWalksAt([]);
    expect(upwardCeilingOf(join(dir, 'mono', 'tools'))).toBeUndefined();
  });

  it('reads no manifest above the root a run was given for a file in no checkout', () => {
    const dir = tree({ 'package.json': '{ "name": "outside" }', 'loose/src/b.ts': '' });
    expect(packageNameOf(join(dir, 'loose', 'src', 'b.ts'))).toBe('outside');
    boundWalksAt([join(dir, 'loose')]);
    expect(packageNameOf(join(dir, 'loose', 'src', 'b.ts'))).toBeNull();
  });
});
