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

/**
 * What a lockfile states of a package it pins (P345): the keywords and the
 * peer dependencies its entry writes, where it writes them - npm's
 * `package-lock.json` (its `packages` entry, `keywords` and
 * `peerDependencies`), pnpm's `pnpm-lock.yaml` and yarn's `yarn.lock` (the
 * entry's `peerDependencies`). Read without the package being installed.
 */
export interface LockedPackage {
  readonly lockfile: string;
  readonly keywords: readonly string[];
  readonly peers: readonly string[];
}

const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock'] as const;

const textAt = (path: string): string | undefined => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

const stringsOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : []);

/** The entry of npm's lockfile for a package: the nearest `node_modules/<name>` of its `packages`. */
const npmLocked = (text: string, name: string): Omit<LockedPackage, 'lockfile'> | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const packages = typeof parsed === 'object' && parsed !== null ? (parsed as { packages?: unknown }).packages : undefined;
  if (typeof packages !== 'object' || packages === null) return undefined;
  const entry = (packages as Record<string, unknown>)[`node_modules/${name}`];
  if (typeof entry !== 'object' || entry === null) return undefined;
  const { keywords, peerDependencies } = entry as { keywords?: unknown; peerDependencies?: unknown };
  return { keywords: stringsOf(keywords), peers: typeof peerDependencies === 'object' && peerDependencies !== null ? Object.keys(peerDependencies) : [] };
};

const unquoted = (text: string): string => text.trim().replace(/^['"]|['"]$/g, '');

/**
 * The entry of a YAML-shaped lockfile for a package (pnpm's, yarn's): the
 * block under the first key naming it at `indent` - `name@1.0.0:`,
 * `/name@1.0.0:`, `/name/1.0.0:`, `"name@npm:^1.0.0, name@^1.0.0":` - and the
 * keys of its `peerDependencies`.
 */
const yamlLocked = (text: string, name: string, indent: number): Omit<LockedPackage, 'lockfile'> | undefined => {
  const lines = text.split(/\r?\n/);
  const pad = ' '.repeat(indent);
  const names = (key: string): boolean =>
    key.split(',').some((each) => {
      const descriptor = unquoted(each).replace(/^\//, '');
      return descriptor.startsWith(`${name}@`) || descriptor.startsWith(`${name}/`);
    });
  const start = lines.findIndex((line) => line.startsWith(pad) && !line.startsWith(`${pad} `) && line.trimEnd().endsWith(':') && names(line.trim().slice(0, -1)));
  if (start < 0) return undefined;
  const peers: string[] = [];
  let peerIndent: number | undefined;
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue;
    const depth = line.length - line.trimStart().length;
    if (depth <= indent) break;
    if (peerIndent !== undefined && depth > peerIndent) {
      const key = /^\s*(['"]?[^'":]+['"]?)\s*:/.exec(line)?.[1];
      if (key !== undefined) peers.push(unquoted(key));
      continue;
    }
    peerIndent = line.trim() === 'peerDependencies:' ? depth : undefined;
  }
  return { keywords: [], peers };
};

/**
 * {@link LockedPackage} of a package for an application in `repoDir`, from the
 * nearest lockfile from the application up to the topmost workspace that holds
 * it (P345). Undefined where no lockfile there pins it.
 */
export const lockedPackageFinder = (repoDir: string): ((name: string) => LockedPackage | undefined) => {
  const roots = [...(workspaceGlobs(repoDir).length > 0 ? [repoDir] : []), ...workspaceRootsAbove(repoDir)];
  const top = resolve(roots[roots.length - 1] ?? repoDir);
  const found: { readonly path: string; readonly text: string }[] = [];
  for (let at = resolve(repoDir); ; at = dirname(at)) {
    for (const lockfile of LOCKFILES) {
      const path = join(at, lockfile);
      const text = existsSync(path) ? textAt(path) : undefined;
      if (text !== undefined) found.push({ path, text });
    }
    if (at === top || dirname(at) === at) break;
  }
  return (name) => {
    for (const { path, text } of found) {
      const entry = path.endsWith('.json') ? npmLocked(text, name) : path.endsWith('pnpm-lock.yaml') ? yamlLocked(text, name, 2) : yamlLocked(text, name, 0);
      if (entry !== undefined) return { lockfile: path, ...entry };
    }
    return undefined;
  };
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
