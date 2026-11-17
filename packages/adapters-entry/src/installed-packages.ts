import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { toPosixPath, workspaceGlobs, workspacePackages, workspaceRootsAbove } from '@flowatlas/core';

/**
 * A package a framework is handed by its name, as Node resolves it from the
 * application (P335): its directory, its manifest, and whether it is one
 * installed into `node_modules` - a registry's code - rather than a package
 * of the workspace (a member by that name, or what `node_modules` links it
 * to where the link leads out of every `node_modules`).
 */
export interface PackageAt {
  readonly dir: string;
  readonly installed: boolean;
  readonly manifest: Readonly<Record<string, unknown>>;
}

const manifestAt = (dir: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

const realOf = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

/**
 * Where a package `name` is for an application in `repoDir` (P335): a package
 * of its workspace by that name, else the nearest `node_modules/<name>` from
 * the application up to the topmost workspace that holds it (the repository
 * the application is in, never beyond it). Undefined where it is in neither:
 * not installed here.
 */
export const packageDirOf = (repoDir: string, name: string): PackageAt | undefined => packageFinder(repoDir)(name);

/**
 * {@link packageDirOf} for many names from one application (P335): its
 * workspace's packages listed once.
 */
export const packageFinder = (repoDir: string): ((name: string) => PackageAt | undefined) => {
  const roots = [...(workspaceGlobs(repoDir).length > 0 ? [repoDir] : []), ...workspaceRootsAbove(repoDir)];
  const members = roots.flatMap((root) => workspacePackages(root));
  const top = resolve(roots[roots.length - 1] ?? repoDir);
  return (name) => {
    const member = members.find((pkg) => pkg.name === name);
    const manifest = member === undefined ? undefined : manifestAt(member.dir);
    if (member !== undefined && manifest !== undefined) return { dir: member.dir, installed: false, manifest };
    return installedAt(repoDir, top, name);
  };
};

/** The nearest `node_modules/<name>` from an application up to the topmost workspace that holds it. */
const installedAt = (repoDir: string, top: string, name: string): PackageAt | undefined => {
  for (let at = resolve(repoDir); ; at = dirname(at)) {
    const linked = join(at, 'node_modules', name);
    const manifest = existsSync(join(linked, 'package.json')) ? manifestAt(linked) : undefined;
    if (manifest !== undefined) {
      const real = toPosixPath(realOf(linked));
      return real.includes('/node_modules/') ? { dir: linked, installed: true, manifest } : { dir: real, installed: false, manifest };
    }
    if (at === top || dirname(at) === at) return undefined;
  }
};

/** The package a directory holds, read from its `package.json`, or undefined where it has none. */
export const packageAtDir = (dir: string): PackageAt | undefined => {
  const manifest = manifestAt(dir);
  return manifest === undefined ? undefined : { dir, installed: toPosixPath(dir).includes('/node_modules/'), manifest };
};

/** The package name a specifier names, and the path inside it: `@shop/config/server.json` is `@shop/config` and `server.json`. */
export const packageOfSpecifier = (specifier: string): { readonly name: string; readonly subpath: string } => {
  const parts = specifier.split('/');
  const width = specifier.startsWith('@') ? 2 : 1;
  return { name: parts.slice(0, width).join('/'), subpath: parts.slice(width).join('/') };
};

/** Whether a specifier is a package's name rather than a path. */
export const isPackageSpecifier = (specifier: string): boolean => /^(?:@[\w.-]+\/)?[\w.-]+(?:\/|$)/.test(specifier) && !specifier.startsWith('.');

/**
 * The target `exports` maps a subpath to for `require` (P335), as Node's
 * resolver picks a condition: the first of `require`, `node` and `default`
 * the object writes, nested conditions followed; a plain string for any.
 */
const exportTarget = (value: unknown, conditions: readonly string[]): string | undefined => {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (!conditions.includes(key)) continue;
    const found = exportTarget(inner, conditions);
    if (found !== undefined) return found;
  }
  return undefined;
};

/**
 * The file `require('<name>/<subpath>')` loads from a package (P335): its
 * `exports` entry for the subpath under the conditions given (`require`,
 * `node`, `default` where none are), else the subpath itself, the package's
 * `main`, or its `index.js`, each tried as a file, with `.js` and `.json`,
 * and as a directory's index. Undefined where none of them is there.
 */
export const packageFileOf = (pkg: PackageAt, subpath: string, conditions: readonly string[] = ['require', 'node', 'default']): string | undefined => {
  const exportsField = pkg.manifest['exports'];
  const key = subpath === '' ? '.' : `./${subpath}`;
  let target: string | undefined;
  if (exportsField !== undefined) {
    const map = typeof exportsField === 'object' && exportsField !== null && !Array.isArray(exportsField) && Object.keys(exportsField).some((each) => each.startsWith('.')) ? (exportsField as Record<string, unknown>) : { '.': exportsField };
    target = exportTarget(map[key], conditions);
  }
  const main = typeof pkg.manifest['main'] === 'string' ? (pkg.manifest['main'] as string) : 'index.js';
  const written = target ?? (subpath === '' ? main : subpath);
  const base = join(pkg.dir, written);
  for (const candidate of [base, `${base}.js`, `${base}.json`, join(base, 'index.js')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // Not this one.
    }
  }
  return undefined;
};
