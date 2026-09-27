import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { serviceSourceDirs, workspaceRootOf } from '@flowatlas/core';
import { hashFile, type DependencyState } from './cache.js';

/**
 * Whether a service's dependencies are there, as the rebuild plan means it.
 *
 * The plan keyed on source hashes, the configuration and the tool's own version,
 * and it did not notice `node_modules` appearing. So the ordinary sequence —
 * clone, build, install, build — printed `cached (0 files changed)` the second
 * time and served the first graph. Measured on novu: installing moves entries
 * from 415 to 420, `http_out` from 8 to 71, `guarded_by` from 336 to 663 and
 * `external_api` from 1 to 7, and the second build kept the smaller answer
 * without a word (R92).
 *
 * The point is not that a file changed. It is that **a graph read without
 * dependencies present and one read with them are different answers to the same
 * question**: the checker resolves a type into a package or it does not, and
 * everything that type was going to say is either in the graph or missing from
 * it. A plan that cannot see the difference is comparing two readings that were
 * never comparable. So the state of the dependencies is an input to the plan in
 * the same way the tsconfig is, and a build that finds it changed re-reads.
 *
 * ## Where it looks, and why only there
 *
 * The same extent the reading itself uses: the service's own directory, the
 * workspace packages it declares — `serviceSourceDirs`, the one discoverer of
 * that question — and the workspace root above it, which is where a package
 * manager hoists what it installed and where the lockfile lives. Not further up.
 * A directory that is nobody's workspace member gets its own answer and nothing
 * else, so pointing the tool at a bare directory does not make its plan depend on
 * a lockfile belonging to whatever checkout happens to be above it.
 *
 * ## What is not used
 *
 * The modification time of `node_modules`, which was the other suggestion on the
 * ticket. A clock inside something the plan compares is the defect this project
 * has already closed once: `generatedAt` sat inside the artefact the plan hashed
 * and every extraction of an unchanged tree read as an edit (R82). An install
 * that changes a package without changing the lockfile is real and is not caught
 * here; catching it with a timestamp would mean every reinstall of the same
 * lockfile re-read everything, which is the expensive way to be wrong and the
 * one that teaches people to distrust the plan.
 */

/**
 * The files a package manager writes down what it installed in.
 *
 * Data, not code: one line per file, and the list is what "a lockfile" means
 * here. Every one that is present is hashed, because a repository carrying two
 * of them has two answers and both of them moving is still a change.
 */
const LOCKFILES: readonly string[] = [
  'pnpm-lock.yaml',
  'yarn.lock',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'bun.lockb',
  'bun.lock',
];

/** Where an install lands, as a directory holding one. */
const INSTALLED_IN = 'node_modules';

/** Nothing installed and nothing written down: what a bare directory amounts to. */
export const NO_DEPENDENCIES: DependencyState = { installed: [], lockfiles: {} };

/** Paths are kept relative to the repository, so a checkout that moved is not a change. */
const asKey = (repoDir: string, path: string): string => {
  const rooted = relative(repoDir, path).split(sep).join('/');
  return rooted === '' ? '.' : rooted;
};

/**
 * Every directory that can hold this service's dependencies, nearest first.
 *
 * The service's own directory first because that is where a reader looks first,
 * then the packages it declares, then the workspace root, which is not part of
 * the service's source and is where most of an install actually is.
 */
const rootsFor = (repoDir: string): readonly string[] => {
  const dirs = [...serviceSourceDirs(repoDir)];
  const workspace = workspaceRootOf(repoDir);
  if (workspace !== undefined && !dirs.includes(workspace)) dirs.push(workspace);
  return dirs;
};

/** What is installed for this service right now, read from disk. */
export const surveyDependencies = (repoDir: string): DependencyState => {
  const installed: string[] = [];
  const lockfiles: Record<string, string> = {};
  for (const dir of rootsFor(repoDir)) {
    if (existsSync(join(dir, INSTALLED_IN))) installed.push(asKey(repoDir, dir));
    for (const lockfile of LOCKFILES) {
      const path = join(dir, lockfile);
      if (existsSync(path)) lockfiles[asKey(repoDir, path)] = hashFile(path);
    }
  }
  return { installed, lockfiles };
};

/**
 * What changed about the dependencies since the cache was written, in one phrase.
 *
 * Installs before lockfiles, because an install appearing is the change that
 * moves the answer most and the one a reader is likeliest to have just caused.
 * One phrase and not a list: it is the reason a repository is being re-read, and
 * a reason is a sentence somebody reads in a summary.
 */
export const dependencyChange = (
  before: DependencyState | undefined,
  after: DependencyState,
): string | undefined => {
  // Nothing recorded is not the same as nothing installed. The last reading of
  // this repository did not say whether its dependencies were there, so nothing
  // here can say the answer would be the same, and the cheap wrong answer is the
  // one this ticket is about.
  if (before === undefined) return 'dependencies not recorded by the last build';
  const had = new Set(before.installed);
  const has = new Set(after.installed);
  const arrived = after.installed.filter((dir) => !had.has(dir));
  if (arrived.length > 0) return `dependencies installed in ${arrived.join(', ')}`;
  const gone = before.installed.filter((dir) => !has.has(dir));
  if (gone.length > 0) return `dependencies removed from ${gone.join(', ')}`;

  const names = [...new Set([...Object.keys(before.lockfiles), ...Object.keys(after.lockfiles)])].sort();
  for (const name of names) {
    const was = before.lockfiles[name];
    const now = after.lockfiles[name];
    if (was === now) continue;
    if (was === undefined) return `${name} appeared`;
    if (now === undefined) return `${name} is gone`;
    return `${name} changed`;
  }
  return undefined;
};
