import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { workspaceRootsAbove } from '@flowatlas/core';

/** A patch a repository commits to a library it installs, and where it is. */
export interface LibraryPatch {
  /** Repository-relative POSIX path of the patch file. */
  readonly path: string;
  readonly text: string;
}

const readJson = (path: string): Record<string, unknown> | undefined => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

const readText = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

/** Whether a key of a dependency list names the library: `lib`, `lib@1.2.3`, or a resolution ending in it. */
const namesLibrary = (key: string, library: string): boolean => key === library || key.startsWith(`${library}@`) || key.endsWith(`/${library}`);

/**
 * The patches a repository commits to the libraries named (P275), however
 * its package manager applies them:
 *
 * - Yarn's `patch:` protocol in a dependency or a resolution,
 *   `patch:lib@npm%3A1.0.0#~/.yarn/patches/lib.patch` - `~/` the project's
 *   root, anything else the manifest's directory;
 * - pnpm's `pnpm.patchedDependencies` (`"lib@1.0.0": "patches/lib.patch"`);
 * - patch-package's `patches/lib+1.0.0.patch` (a scope's `/` written `+`).
 *
 * Read in the package and in each workspace that declares it.
 */
export const libraryPatches = (repoDir: string, libraries: readonly string[]): LibraryPatch[] => {
  if (libraries.length === 0) return [];
  const dirs = [resolve(repoDir), ...workspaceRootsAbove(repoDir)];
  // Yarn's project root: the outermost of these holding its lockfile or settings.
  const yarnRoot = [...dirs].reverse().find((dir) => existsSync(join(dir, 'yarn.lock')) || existsSync(join(dir, '.yarnrc.yml'))) ?? dirs[dirs.length - 1] ?? repoDir;
  const found = new Map<string, LibraryPatch>();
  const add = (path: string): void => {
    const absolute = resolve(path);
    if (found.has(absolute)) return;
    const text = readText(absolute);
    if (text !== undefined) found.set(absolute, { path: relative(repoDir, absolute).replace(/\\/g, '/'), text });
  };
  for (const dir of dirs) {
    const manifest = readJson(join(dir, 'package.json'));
    for (const list of ['dependencies', 'devDependencies', 'optionalDependencies', 'resolutions', 'overrides']) {
      const entries = manifest?.[list];
      if (entries === null || typeof entries !== 'object') continue;
      for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
        if (typeof value !== 'string' || !value.startsWith('patch:') || !libraries.some((library) => namesLibrary(key, library))) continue;
        const written = decodeURIComponent(value.slice(value.lastIndexOf('#') + 1)).replace(/::.*$/, '');
        if (written === '' || value.lastIndexOf('#') === -1) continue;
        add(written.startsWith('~/') ? join(yarnRoot, written.slice(2)) : join(dir, written));
      }
    }
    const pnpm = manifest?.['pnpm'];
    const patched = pnpm !== null && typeof pnpm === 'object' ? (pnpm as Record<string, unknown>)['patchedDependencies'] : undefined;
    if (patched !== null && typeof patched === 'object') {
      for (const [key, value] of Object.entries(patched as Record<string, unknown>)) {
        if (typeof value === 'string' && libraries.some((library) => namesLibrary(key, library))) add(join(dir, value));
      }
    }
    const patches = join(dir, 'patches');
    let names: string[] = [];
    try {
      names = readdirSync(patches);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (name.endsWith('.patch') && libraries.some((library) => name.startsWith(`${library.replace('/', '+')}+`))) add(join(patches, name));
    }
  }
  return [...found.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
};
