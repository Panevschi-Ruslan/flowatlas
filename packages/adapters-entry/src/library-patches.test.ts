import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { libraryPatches } from './library-patches.js';

const made: string[] = [];

/** A directory of these files, removed after the test. */
const tree = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'patches-'));
  made.push(dir);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
};

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the patches a repository commits to a library (P275)', () => {
  it("reads Yarn's patch: protocol, relative to the manifest and to the project's root", () => {
    const root = tree({
      'package.json': JSON.stringify({ workspaces: ['packages/*'] }),
      'yarn.lock': '',
      '.yarn/patches/lib-npm-1.0.0-abc.patch': '+root',
      'packages/api/package.json': JSON.stringify({ dependencies: { '@scope/lib': 'patch:@scope/lib@npm%3A1.0.0#~/.yarn/patches/lib-npm-1.0.0-abc.patch::version=1.0.0' } }),
    });
    expect(libraryPatches(join(root, 'packages', 'api'), ['@scope/lib'])).toEqual([{ path: '../../.yarn/patches/lib-npm-1.0.0-abc.patch', text: '+root' }]);
    const local = tree({
      'package.json': JSON.stringify({ dependencies: { lib: 'patch:lib@npm%3A1.0.0#./patches/lib.patch' } }),
      'patches/lib.patch': '+local',
    });
    expect(libraryPatches(local, ['lib']).map((patch) => patch.text)).toEqual(['+local']);
  });

  it("reads pnpm's patchedDependencies and patch-package's file names, and nothing of another library", () => {
    const dir = tree({
      'package.json': JSON.stringify({ pnpm: { patchedDependencies: { '@scope/lib@1.0.0': 'fixes/lib.patch' } } }),
      'fixes/lib.patch': '+pnpm',
      'patches/@scope+lib+1.0.0.patch': '+patch-package',
      'patches/other+1.0.0.patch': '+other',
    });
    expect(libraryPatches(dir, ['@scope/lib']).map((patch) => patch.text).sort()).toEqual(['+patch-package', '+pnpm']);
  });
});
