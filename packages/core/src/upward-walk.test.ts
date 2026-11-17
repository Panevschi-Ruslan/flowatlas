import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packageNameOf } from './origin.js';
import { sourceRootsOf } from './project.js';
import { checkoutTopOf, forgetCheckouts, isNoRepositoryDir, mayClimbTo, upwardCeilingOf } from './upward-walk.js';
import { forgetWorkspaces, scanCeilingOf, workspaceRootsAbove } from './workspace.js';

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
