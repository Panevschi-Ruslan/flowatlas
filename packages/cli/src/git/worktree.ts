/**
 * Reading a repository at another commit without touching what is checked out.
 *
 * `git worktree add --detach` puts the commit somewhere else on disk and leaves
 * the working tree exactly as it was — uncommitted work included. That is the
 * whole reason this file exists rather than a stash and a checkout: a tool that
 * reads your repository must never be able to lose your work.
 */
import { execFile } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Runs git in a repository and hands back stdout, or throws with its stderr. */
const git = async (repo: string, args: readonly string[]): Promise<string> => {
  const { stdout } = await run('git', ['-C', repo, ...args], { maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
};

const quietly = async (repo: string, args: readonly string[]): Promise<string | null> => {
  try {
    return await git(repo, args);
  } catch {
    return null;
  }
};

const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

/**
 * Whether this directory is the root of a git repository.
 *
 * The top level rather than "git answers here", because every directory inside
 * a repository answers here, and a service configured at a subdirectory of one
 * is not a repository whose refs mean anything about that service.
 */
export const isGitRepo = async (dir: string): Promise<boolean> => {
  const top = await quietly(dir, ['rev-parse', '--show-toplevel']);
  return top !== null && real(top) === real(dir);
};

/** The commit a ref names, or null when the repository has no such ref. */
export const resolveSha = async (repo: string, ref: string): Promise<string | null> =>
  quietly(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);

/** True when the working tree has changes the ref-based read would not see. */
export const isDirty = async (repo: string): Promise<boolean> => {
  const status = await quietly(repo, ['status', '--porcelain']);
  return status !== null && status !== '';
};

/**
 * Worktree records left behind by a run that was killed.
 *
 * Cheap, safe, and it only removes entries whose directory is gone — which is
 * exactly what a temporary directory the operating system cleared leaves.
 */
export const pruneWorktrees = async (repo: string): Promise<void> => {
  await quietly(repo, ['worktree', 'prune']);
};

/** Where the dependencies the type checker resolved against came from. */
export type NodeModules = 'linked' | 'present' | 'missing';

export interface Checkout {
  /** Absolute path of the detached worktree. */
  dir: string;
  sha: string;
  nodeModules: NodeModules;
}

/**
 * Dependencies for a tree that has none, without installing any.
 *
 * A worktree is the tracked files and nothing else, and the type checker needs
 * the packages to resolve an imported shape. Installing per revision is
 * minutes; a symlink to what is already installed is free. What it costs is
 * honesty about versions: the packages are the working tree's, not the ref's,
 * and that is recorded rather than hidden.
 */
const linkDependencies = (repo: string, dir: string): NodeModules => {
  const target = join(dir, 'node_modules');
  // A repository that keeps its stubs in git already has them here, and
  // replacing them with the checkout's would be answering a question nobody
  // asked.
  if (existsSync(target)) return 'present';
  const source = join(repo, 'node_modules');
  if (!existsSync(source)) return 'missing';
  try {
    symlinkSync(source, target, 'dir');
    return 'linked';
  } catch {
    return 'missing';
  }
};

/** Removes a link and never what it points at; a real directory is left alone. */
const unlinkIfSymlink = (path: string): void => {
  try {
    if (lstatSync(path).isSymbolicLink()) unlinkSync(path);
  } catch {
    // Not there, which is the state we wanted it in.
  }
};

/**
 * A repository at one commit, for as long as `fn` needs it, and then gone.
 *
 * The removal is in a `finally`, so a read that throws still leaves the
 * repository as it found it. `--force` because the tree it is removing has an
 * output directory and a `node_modules` in it that git knows nothing about, and
 * refusing to clean up after ourselves is not a safety feature.
 */
export const withWorktree = async <T>(
  repo: string,
  sha: string,
  fn: (checkout: Checkout) => Promise<T>,
  options: { keep?: boolean } = {},
): Promise<T> => {
  const root = real(repo);
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'flowatlas-wt-'));
  const dir = join(parent, sha.slice(0, 8));

  // The one thing this must never do. A worktree at the checkout itself would
  // mean git rewriting the files somebody is working in.
  if (real(parent) === root || dir === root) {
    rmSync(parent, { recursive: true, force: true });
    throw new Error(`refusing to make a worktree of ${repo} inside itself`);
  }

  await git(repo, ['worktree', 'add', '--detach', dir, sha]);
  try {
    return await fn({ dir, sha, nodeModules: linkDependencies(repo, dir) });
  } finally {
    // Kept only when somebody asked for it in as many words, and even then the
    // link into the checkout's own packages goes, so nothing left behind can
    // lead a later `rm -rf` back into a repository.
    unlinkIfSymlink(join(dir, 'node_modules'));
    if (options.keep !== true) {
      await quietly(repo, ['worktree', 'remove', '--force', dir]);
      rmSync(parent, { recursive: true, force: true });
      await pruneWorktrees(repo);
    }
  }
};
