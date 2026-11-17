import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { rangeIncludes, toPosixPath } from '@flowatlas/core';

/**
 * Which version of the CDK an app is built with, as far as the repository
 * says (P322).
 *
 * Some of what the CDK writes into a template depends on its version: where a
 * grant to a principal of another account goes, for one. The app is read
 * without running it, so the version is read from the files that pin it: the
 * library installed beside the app, else the lockfile nearest it, else the
 * range its `package.json` asks for. A question about the version is answered
 * only where every version these allow gives the same answer.
 */

/** The library whose version is read. */
const LIBRARY = 'aws-cdk-lib';

type Version = readonly [number, number, number];

const versionOf = (written: string): Version | undefined => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(written.trim());
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
};

const compare = (a: Version, b: Version): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** What the repository says of the version: the versions it pins, or the range it asks for. */
type Pinned =
  | { readonly versions: readonly string[]; readonly from: string }
  | { readonly range: string; readonly from: string; readonly library: string };

export interface CdkLibrary {
  /**
   * Whether the app is built with `aws-cdk-lib` at `minimum` or later: true
   * or false where every version the repository allows says so, undefined
   * where they differ or nothing says.
   */
  readonly atLeast: (minimum: string) => boolean | undefined;
  /** What the version was read from, as a person reads it: `aws-cdk-lib 2.190.0 (package-lock.json)`. */
  readonly said: string | undefined;
  /** Repo-relative files read for it. */
  readonly files: readonly string[];
}

/** The directories from the app's up to the repository's, nearest first. */
const upFrom = (appDir: string, repoDir: string): string[] => {
  const out: string[] = [];
  const root = resolve(repoDir);
  let dir = resolve(appDir);
  for (let depth = 0; depth < 16; depth += 1) {
    out.push(dir);
    if (dir === root || !dir.startsWith(root)) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return out;
};

const readJson = (path: string): Record<string, unknown> | undefined => {
  try {
    const json: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return json !== null && typeof json === 'object' ? (json as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** The versions of the library a lockfile pins: npm's, pnpm's or yarn's. */
const lockedVersions = (path: string): string[] => {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const found = new Set<string>();
  if (path.endsWith('package-lock.json')) {
    const json = readJson(path);
    for (const [key, entry] of Object.entries(recordOf(json?.['packages']) ?? {})) {
      const version = recordOf(entry)?.['version'];
      if ((key === `node_modules/${LIBRARY}` || key.endsWith(`/node_modules/${LIBRARY}`)) && typeof version === 'string') found.add(version);
    }
    const old = recordOf(recordOf(json?.['dependencies'])?.[LIBRARY])?.['version'];
    if (typeof old === 'string') found.add(old);
  } else if (path.endsWith('pnpm-lock.yaml')) {
    // `aws-cdk-lib@2.190.0:`, `/aws-cdk-lib@2.190.0(constructs@10.4.2):`, `/aws-cdk-lib/2.100.0:` as each lockfile version keys a package.
    for (const match of text.matchAll(/^\s+['"]?\/?aws-cdk-lib[@/](\d+\.\d+\.\d+)/gm)) found.add(match[1] as string);
  } else {
    // yarn: the version under each entry that names the library.
    for (const match of text.matchAll(/^"?aws-cdk-lib@[^\n]*:\n(?:[ \t]+[^\n]*\n)*?[ \t]+version:? "?(\d+\.\d+\.\d+)/gm)) found.add(match[1] as string);
  }
  return [...found].filter((each) => versionOf(each) !== undefined).sort();
};

const LOCKFILES = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock'];

/** What the repository pins the library at, and the files it read to say so. */
const pinnedOf = (appDir: string, repoDir: string): { pinned: Pinned | undefined; files: string[] } => {
  const dirs = upFrom(appDir, repoDir);
  const files: string[] = [];
  const rel = (path: string): string => toPosixPath(relative(repoDir, path));
  for (const dir of dirs) {
    const path = join(dir, 'node_modules', LIBRARY, 'package.json');
    const version = readJson(path)?.['version'];
    if (typeof version === 'string' && versionOf(version) !== undefined) return { pinned: { versions: [version], from: `${rel(dir) || '.'}/node_modules` }, files };
  }
  for (const dir of dirs) {
    for (const name of LOCKFILES) {
      const path = join(dir, name);
      if (!existsSync(path)) continue;
      files.push(rel(path));
      const versions = lockedVersions(path);
      if (versions.length > 0) return { pinned: { versions, from: rel(path) }, files };
    }
  }
  for (const dir of dirs) {
    const path = join(dir, 'package.json');
    const manifest = readJson(path);
    if (manifest === undefined) continue;
    files.push(rel(path));
    // Version 1 of the CDK is its own packages, `@aws-cdk/core` the root of them.
    for (const library of [LIBRARY, '@aws-cdk/core']) {
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
        const range = recordOf(manifest[field])?.[library];
        if (typeof range === 'string') return { pinned: { range, from: rel(path), library }, files };
      }
    }
  }
  return { pinned: undefined, files };
};

/**
 * Whether every version a range allows is at `minimum` or later, or every
 * one is before it: a range of one comparator set reaching up from its
 * lowest version (`2.190.0`, `^2.190.0`, `~2.150.0`, `>=2.190.0`).
 */
const rangeAtLeast = (range: string, minimum: Version, written: string): boolean | undefined => {
  const trimmed = range.trim();
  if (/\|\||<|\s-\s|\*|\bx\b|^latest$/.test(trimmed)) return undefined;
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 1) return undefined;
  const floor = versionOf((parts[0] as string).replace(/^(\^|~|>=|=)/, ''));
  if (floor === undefined) return undefined;
  if (compare(floor, minimum) >= 0) return true;
  return rangeIncludes(trimmed, written) === false && !trimmed.startsWith('>=') ? false : undefined;
};

/** The version of the CDK the app at `appDir` is built with, as the repository pins it. */
export const cdkLibraryOf = (appDir: string, repoDir: string): CdkLibrary => {
  const { pinned, files } = pinnedOf(appDir, repoDir);
  const atLeast = (minimum: string): boolean | undefined => {
    const floor = versionOf(minimum);
    if (pinned === undefined || floor === undefined) return undefined;
    if ('range' in pinned) return rangeAtLeast(pinned.range, floor, minimum);
    const answers = new Set(pinned.versions.map((each) => compare(versionOf(each) as Version, floor) >= 0));
    return answers.size === 1 ? [...answers][0] : undefined;
  };
  const said =
    pinned === undefined ? undefined : 'range' in pinned ? `${pinned.library} ${pinned.range} (${pinned.from})` : `${LIBRARY} ${pinned.versions.join(', ')} (${pinned.from})`;
  return { atLeast, said, files };
};
