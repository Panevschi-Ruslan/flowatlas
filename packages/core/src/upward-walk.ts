import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isWithinDir } from './ids.js';

/**
 * How far a walk up from a directory of a scanned repository may read (P334).
 *
 * Several readings look for something in a directory and every directory
 * above it, the way Node finds `node_modules` or a tool finds its
 * configuration. Followed to the top of the file system, such a walk reads
 * files outside the repository being analysed - a package installed in the
 * home directory, a manifest of an unrelated checkout above it - and lets
 * them into the graph. Every such walk stops at the repository: the root a
 * reading was given where it was given one (widened to the workspace that
 * declares it as a member, `scanCeilingOf`), else the top of the checkout the
 * walk starts in (the nearest directory holding `.git`); and it never reads
 * in the home directory or at the root of the file system, which are no
 * repository's.
 */

/** Something that answers whether a path exists: the disk, or a project's own file system. */
export type PathExists = (path: string) => boolean;

const onDisk: PathExists = (path) => existsSync(path);

const homeDir = ((): string | undefined => {
  try {
    const home = homedir();
    return home === '' ? undefined : resolve(home);
  } catch {
    return undefined;
  }
})();

/** Whether a directory is one no repository is: the root of the file system, or the home directory. */
export const isNoRepositoryDir = (dir: string): boolean => {
  const own = resolve(dir);
  return dirname(own) === own || own === homeDir;
};

const checkouts = new Map<string, string | null>();

/**
 * The top of the checkout a directory is in: the nearest directory at or
 * above it holding `.git` (a clone's directory or a worktree's file), never
 * the home directory or the file system's root. Nothing where there is none.
 */
export const checkoutTopOf = (dir: string, exists: PathExists = onDisk): string | undefined => {
  const start = resolve(dir);
  const cached = exists === onDisk ? checkouts.get(start) : undefined;
  if (cached !== undefined) return cached ?? undefined;
  let found: string | undefined;
  for (let at = start; !isNoRepositoryDir(at); at = dirname(at)) {
    let holds = false;
    try {
      holds = exists(join(at, '.git'));
    } catch {
      holds = false;
    }
    if (holds) {
      found = at;
      break;
    }
  }
  if (exists === onDisk) checkouts.set(start, found ?? null);
  return found;
};

/**
 * The highest directory a walk up from `start` may read where the reading was
 * given no root of its own (P334): the top of the checkout `start` is in.
 * Nothing where it is in none: such a walk still never reads in the home
 * directory or at the root of the file system ({@link mayClimbTo}).
 */
export const upwardCeilingOf = (start: string, exists: PathExists = onDisk): string | undefined => checkoutTopOf(start, exists);

/** Whether a walk bounded by `ceiling` may read in `dir` (P334). */
export const mayClimbTo = (dir: string, ceiling: string | undefined): boolean =>
  ceiling === undefined ? !isNoRepositoryDir(dir) : isWithinDir(resolve(dir), ceiling);

/** Forgets the checkouts this process found, for a test that makes one. */
export const forgetCheckouts = (): void => checkouts.clear();
