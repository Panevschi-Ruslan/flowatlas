import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import * as nativePath from 'node:path';
import { posix } from 'node:path';
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

/**
 * The path functions a path is spelled for: a POSIX path (`/repo/src`, the
 * disk's on macOS and Linux, an in-memory project's anywhere) is walked as
 * one on Windows too, where `path.resolve` would put the drive in front and
 * `path.join` turn its slashes round, so that it names another file.
 */
export const pathsOf = (path: string): typeof posix => (path.startsWith('/') ? posix : nativePath);
const resolve = (path: string): string => pathsOf(path).resolve(path);
const dirname = (path: string): string => pathsOf(path).dirname(path);
const join = (path: string, ...rest: string[]): string => pathsOf(path).join(path, ...rest);

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
 * The directories a run was asked to read (P340): the root of its
 * configuration and every service's, each widened to the outermost workspace
 * that declares it as a member. Set once per build or reading
 * (`boundWalksAt` in `workspace.ts`) - every command loading a configuration
 * sets them (P357) - and added to by a reading that opens a project given
 * none ({@link addScanRoot}). Each is kept as it is spelled and as the path
 * it really is, so a directory reached through a link to one is still found
 * under it.
 */
interface ScanRoot {
  readonly spelled: string;
  readonly real: string | undefined;
}

const scanRoots: ScanRoot[] = [];

const reals = new Map<string, string>();

/**
 * The path a directory really is, where the disk holds it; nothing for one it
 * does not hold (an in-memory project's), asked again later, when it may.
 */
const realOf = (dir: string): string | undefined => {
  const cached = reals.get(dir);
  if (cached !== undefined) return cached;
  try {
    const real = resolve(realpathSync.native(dir));
    reals.set(dir, real);
    return real;
  } catch {
    return undefined;
  }
};

const scanRootFor = (dir: string): ScanRoot => {
  const spelled = resolve(dir);
  const real = realOf(spelled);
  return { spelled, real: real === spelled ? undefined : real };
};

/** Sets the directories a run was asked to read, replacing any set before (P340). */
export const setScanRoots = (roots: readonly string[]): void => {
  scanRoots.splice(0, scanRoots.length, ...[...new Set(roots.map(resolve))].map(scanRootFor));
};

/** The outermost of `roots` holding `at`. */
const outermostHolding = (at: string, roots: ReadonlyArray<string | undefined>): string | undefined => {
  let found: string | undefined;
  for (const root of roots) {
    if (root === undefined || !isWithinDir(at, root)) continue;
    if (found === undefined || isWithinDir(found, root)) found = root;
  }
  return found;
};

/**
 * The outermost directory a run was asked to read that holds `dir`, when one
 * does (P340), spelled as `dir` is: a directory and a root may be spelled
 * through different links to the same place - a temporary directory the
 * compiler reaches through the link above it - so each is also compared by
 * the path it really is (P357).
 */
export const scanRootOf = (dir: string): string | undefined => {
  if (scanRoots.length === 0) return undefined;
  const own = resolve(dir);
  const spelled = outermostHolding(own, scanRoots.map((root) => root.spelled));
  if (spelled !== undefined) return spelled;
  const real = realOf(own);
  if (real === undefined) return undefined;
  const found = outermostHolding(real, scanRoots.flatMap((root) => [root.spelled, root.real]));
  if (found === undefined || real === own) return found;
  // The root as `dir` spells it: `dir` with the part below the root taken off.
  const below = pathsOf(real).relative(found, real);
  if (below === '') return own;
  const back = pathsOf(own).resolve(own, ...below.split(/[\\/]/).map(() => '..'));
  return realOf(back) === found ? back : found;
};

/**
 * Adds a directory a reading was asked to read where no directory set holds
 * it already (P357): a library caller opening a project, a reading given no
 * configuration. One already held changes nothing.
 */
export const addScanRoot = (root: string): void => {
  if (scanRootOf(root) === undefined) scanRoots.push(scanRootFor(root));
};

/**
 * The highest directory a walk up from `start` may read where the reading was
 * given no root of its own (P334): the top of the checkout `start` is in, or
 * the outermost directory the run was asked to read that holds it where that
 * is below the checkout's top (P357) - a run given a configuration beside or
 * below its services reads no higher in its checkout than it was asked to,
 * each service widened to the workspace declaring it. Where it is in no
 * checkout, the directory the run was asked to read alone (P340,
 * {@link scanRootOf}). Nothing where there is neither: such a walk still
 * never reads in the home directory or at the root of the file system
 * ({@link mayClimbTo}).
 */
export const upwardCeilingOf = (start: string, exists: PathExists = onDisk): string | undefined => {
  const top = checkoutTopOf(start, exists);
  const root = scanRootOf(start);
  if (top === undefined || root === undefined) return top ?? root;
  return isWithinDir(root, top) ? root : top;
};

/** The deepest directory holding every path given, spelled as they are; nothing for none. */
const commonDirOf = (paths: readonly string[]): string | undefined => {
  let common: string | undefined;
  for (const path of paths) {
    if (common === undefined) {
      common = path;
      continue;
    }
    while (!isWithinDir(path, common)) {
      const parent = dirname(common);
      if (parent === common) return common;
      common = parent;
    }
  }
  return common;
};

/**
 * The top a search for what a repository shares among its services may read
 * from `start` (P357): a contract or a schema kept at the top of a checkout,
 * read by every service below it (the shape P274 reads). Not a walk up for
 * one file but a search under a top, so bounded by everything the run reads
 * in that checkout taken together: the deepest directory holding every
 * directory the run was asked to read there - its configuration's, each
 * service's, a document's - where that holds `start`, else the checkout's
 * top. A run reading one service of a checkout searches that service; one
 * reading several, or the document of a contract kept at the top, searches
 * from the top they share. Where `start` is in no checkout, as
 * {@link upwardCeilingOf}.
 */
export const sharedTopOf = (start: string, exists: PathExists = onDisk): string | undefined => {
  const top = checkoutTopOf(start, exists);
  if (top === undefined) return scanRootOf(start);
  const inside = scanRoots.flatMap((root) => [root.spelled, root.real].filter((path): path is string => path !== undefined && isWithinDir(path, top)).slice(0, 1));
  const span = commonDirOf(inside);
  return span !== undefined && isWithinDir(resolve(start), span) ? span : top;
};

/** Whether a walk bounded by `ceiling` may read in `dir` (P334). */
export const mayClimbTo = (dir: string, ceiling: string | undefined): boolean =>
  ceiling === undefined ? !isNoRepositoryDir(dir) : isWithinDir(resolve(dir), resolve(ceiling));

/** Forgets the checkouts this process found, for a test that makes one. */
export const forgetCheckouts = (): void => {
  checkouts.clear();
  reals.clear();
  scanRoots.length = 0;
};
