import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import {
  compileGlob,
  isBelowDir,
  isGlob,
  isWithinDir,
  NEVER_A_SOURCE,
  NEVER_WALKED,
  packageSourcesFor,
  toPosixPath,
  workspaceGlobs,
  type FlowatlasConfig,
  type Glob,
  type ServiceConfig,
} from '@flowatlas/core';
import type { BuildCache } from './cache.js';

/**
 * What a watch looks at beside the repositories it reads (P206).
 *
 * A build depends on more than the files of its repositories: what stands in
 * for a package nobody installed (P78, P83) is a directory beside the
 * configuration whose manifest names it, a member of a workspace kept there, a
 * shape or pattern file a glob of the configuration expands to, and the source
 * of a package that was read from outside every repository. A watch that
 * looked only inside the repositories rebuilt for none of those until the next
 * save in one of them.
 *
 * Each place is a directory that exists and what below it matters: which
 * directories appearing or going away, and which files appearing, changing or
 * going away. Nothing below it is walked that is not on the way to one of
 * those, so a large tree that appears beside the configuration costs one
 * directory listing rather than a recursive watch. As before, the watcher only
 * says that something happened; the build works out what changed, and says
 * which service it reads again and why, the way a one-off build does.
 */

/** Why a place is watched. */
export type SurroundingKind =
  /** The configuration file itself (P219). */
  | 'configuration'
  /** Where a configured repository is: one that goes away and comes back is watched again. */
  | 'repository'
  /** The directories beside the configuration, and their manifests: the weaker tier of the package index. */
  | 'folders'
  /** The members a workspace kept beside the configuration declares. */
  | 'workspace'
  /** A `shapes` entry of the configuration. */
  | 'shapes'
  /** A `patterns` entry of the configuration. */
  | 'patterns'
  /** Files a reading read from outside every repository: a package source and its manifest. */
  | 'sources';

/** One place watched beside the repositories. */
export interface WatchTarget {
  readonly kind: SurroundingKind;
  /** An existing directory, absolute. */
  readonly dir: string;
  /** Whether a directory at this POSIX path below `dir` matters: walked into, and its coming and going a change. */
  readonly dirs: (rest: string) => boolean;
  /** Whether a file at this POSIX path below `dir` matters. */
  readonly files: (rest: string) => boolean;
  /** What it counts as on the line that says what is watched: one entry, or the files of a directory. */
  readonly count: number;
}

export interface SurroundingsInput {
  readonly config: FlowatlasConfig;
  /** The configuration file, watched for an edit to it (P219); not watched when absent. */
  readonly configPath?: string;
  /** The configuration's directory. */
  readonly rootDir: string;
  readonly repoDirOf: (service: ServiceConfig) => string;
  /** Where the build writes, never a place that stands in for anything. */
  readonly outputDir: string;
  /** Whether a repository's own watch already sees a path. */
  readonly seenByRepository: (path: string) => boolean;
  /** The cache the last build wrote, for the files it read from outside the repositories. */
  readonly cache?: BuildCache | null | undefined;
}

/** The files that make a directory a package or a workspace root, as the package index reads them. */
const MANIFESTS: ReadonlySet<string> = new Set(['package.json', 'pnpm-workspace.yaml']);

const never = (): boolean => false;

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** A path below a directory, POSIX, as a target reads it. */
const restOf = (dir: string, path: string): string => toPosixPath(relative(dir, path));

const samePlace = (a: string, b: string): boolean => isWithinDir(a, b) && isWithinDir(b, a);

/** A name the package index would take a directory under the configuration for. */
const isCandidate = (name: string): boolean => !name.startsWith('.') && !NEVER_A_SOURCE.has(name);

/**
 * A pattern anchored at the deepest directory of it that exists.
 *
 * `flowatlas-shapes/*.d.ts` is watched from `flowatlas-shapes` when it is
 * there and from the configuration's directory when it is not, so the
 * directory appearing is itself a change. A pattern none of whose directories
 * exist short of the root of the file system is not watched at all.
 */
const anchorOf = (absolute: string, lastIsFile: boolean): { dir: string; rest: string[] } | undefined => {
  const segments = toPosixPath(absolute).split('/');
  const firstGlob = segments.findIndex((segment) => isGlob(segment));
  const literal = firstGlob === -1 ? (lastIsFile ? segments.length - 1 : segments.length) : firstGlob;
  for (let depth = literal; depth >= 1; depth -= 1) {
    const dir = segments.slice(0, depth).join('/') || '/';
    if (!isDirectory(dir)) continue;
    if (dirname(dir) === dir) return undefined;
    // In the platform's spelling, as every other place watched is.
    return { dir: resolve(dir), rest: segments.slice(depth) };
  }
  return undefined;
};

/** Every proper prefix of a pattern's segments, as globs: the directories on the way to what it names. */
const prefixesOf = (segments: readonly string[], upTo: number): Glob[] =>
  Array.from({ length: upTo }, (_, index) => compileGlob(segments.slice(0, index + 1).join('/')));

/**
 * A file pattern of the configuration (`shapes`, `patterns`), as a target:
 * the directories on its way, and the files it names. A `**` reaches as deep
 * as the glob does when it is expanded, never into `node_modules` or `.git`
 * unless the pattern names them.
 */
const fileTarget = (
  kind: 'shapes' | 'patterns',
  rootDir: string,
  pattern: string,
): WatchTarget | undefined => {
  const anchored = anchorOf(resolve(rootDir, pattern), true);
  if (anchored === undefined || anchored.rest.length === 0) return undefined;
  const { dir, rest } = anchored;
  const named = new Set(rest);
  const walked = (path: string): boolean =>
    path.split('/').every((segment) => named.has(segment) || !NEVER_WALKED.has(segment));
  const ways = prefixesOf(rest, rest.length - 1);
  const whole = compileGlob(rest.join('/'));
  return {
    kind,
    dir,
    dirs: (path) => walked(path) && ways.some((way) => way.test(path)),
    files: (path) => walked(path) && whole.test(path),
    count: 1,
  };
};

/**
 * One member glob of a workspace kept beside the configuration, as a target:
 * the directories on its way, the members, and each member's manifest. As deep
 * as the workspace's own walk goes, a `**` two levels beyond the rest of it.
 */
const memberTarget = (root: string, glob: string): WatchTarget | undefined => {
  const anchored = anchorOf(resolve(root, glob), false);
  if (anchored === undefined || anchored.rest.length === 0) return undefined;
  const { dir, rest } = anchored;
  const deepest = rest.includes('**') ? rest.length + 2 : rest.length;
  const ways = prefixesOf(rest, rest.length);
  const whole = compileGlob(rest.join('/'));
  const dirs = (path: string): boolean => {
    const segments = path.split('/');
    return segments.length <= deepest && segments.every(isCandidate) && ways.some((way) => way.test(path));
  };
  return {
    kind: 'workspace',
    dir,
    dirs,
    files: (path) => {
      const at = path.lastIndexOf('/');
      const member = path.slice(0, Math.max(at, 0));
      return at > 0 && path.slice(at + 1) === 'package.json' && dirs(member) && whole.test(member);
    },
    count: 1,
  };
};

/** Directories directly under the configuration the package index would read, absolute. */
const candidatesUnder = (rootDir: string): string[] => {
  try {
    return readdirSync(rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isCandidate(entry.name))
      .map((entry) => join(rootDir, entry.name))
      .sort();
  } catch {
    return [];
  }
};

/** Whether any service a build reads searches the directories beside the configuration for packages. */
const searchesFolders = (config: FlowatlasConfig): boolean =>
  config.services.some((service) => service.document === undefined && packageSourcesFor(config, service) === true);

/**
 * The directories beside the configuration, as the package index's weaker
 * tier reads them: one appearing or going away, and the manifest at the top of
 * each, or of the configuration's own directory. Nothing deeper.
 */
const foldersTarget = (rootDir: string, outputDir: string): WatchTarget => {
  const isFolder = (name: string): boolean => isCandidate(name) && !samePlace(join(rootDir, name), outputDir);
  return {
    kind: 'folders',
    dir: rootDir,
    dirs: (path) => !path.includes('/') && isFolder(path),
    files: (path) => {
      const segments = path.split('/');
      if (segments.length === 1) return MANIFESTS.has(path);
      return segments.length === 2 && isFolder(segments[0] as string) && MANIFESTS.has(segments[1] as string);
    },
    count: 1,
  };
};

/**
 * Where each configured repository is: its directory in its parent, nothing
 * else. A repository removed and put back (a fresh clone, a branch that moved
 * it) is a directory the watch of it no longer sees.
 */
const repositoryTargets = (input: SurroundingsInput): WatchTarget[] =>
  input.config.services.flatMap((service) => {
    if (service.document !== undefined) return [];
    const repoDir = input.repoDirOf(service);
    // A repository that holds the configuration goes away with it.
    if (isWithinDir(input.rootDir, repoDir)) return [];
    const parent = dirname(repoDir);
    const name = basename(repoDir);
    if (!isDirectory(parent)) return [];
    return [{ kind: 'repository' as const, dir: parent, dirs: (path: string) => path === name, files: never, count: 0 }];
  });

/**
 * Whether a repository's watch already sees everything a file pattern can
 * name: the pattern's place, its globs stood in for by a plain name, is a path
 * that watch does not ignore. `.shapes/*.d.ts` inside a repository is not one,
 * because a repository's watch leaves dot directories out.
 */
const seenAlready = (target: WatchTarget, rest: string, input: SurroundingsInput): boolean => {
  const probe = join(target.dir, ...rest.split('/').map((segment) => (isGlob(segment) ? 'x' : segment)));
  return input.seenByRepository(probe);
};

/**
 * Files the last build read from outside every repository, grouped by
 * directory: the source of a package read in place of an install, and its
 * manifest. Not an installed package's own files, and not a file another
 * place watched already names.
 */
const sourceTargets = (input: SurroundingsInput, before: readonly WatchTarget[]): WatchTarget[] => {
  const byDir = new Map<string, Set<string>>();
  for (const [name, entry] of Object.entries(input.cache?.repos ?? {})) {
    const service = input.config.services.find((each) => each.name === name);
    if (service === undefined || service.document !== undefined) continue;
    const repoDir = input.repoDirOf(service);
    for (const key of Object.keys(entry.packages ?? {})) {
      const path = resolve(repoDir, key);
      if (toPosixPath(path).includes('/node_modules/') || input.seenByRepository(path)) continue;
      if (before.some((target) => isBelowDir(path, target.dir) && target.files(restOf(target.dir, path)))) continue;
      const dir = dirname(path);
      const names = byDir.get(dir) ?? new Set<string>();
      names.add(basename(path));
      byDir.set(dir, names);
    }
  }
  return [...byDir]
    .filter(([dir]) => isDirectory(dir))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dir, names]) => ({ kind: 'sources' as const, dir, dirs: never, files: (path: string) => names.has(path), count: names.size }));
};

/**
 * Every place beside the repositories a watch looks at, worked out from the
 * configuration, the disk as it is now and the cache the last build wrote.
 * Worked out again after every rebuild, so a directory that appeared is
 * watched from its own place from then on.
 */
export const surroundingsOf = (input: SurroundingsInput): WatchTarget[] => {
  const { config, rootDir, outputDir } = input;
  const targets: WatchTarget[] = [...repositoryTargets(input)];
  if (input.configPath !== undefined) {
    const name = basename(input.configPath);
    targets.push({ kind: 'configuration', dir: dirname(input.configPath), dirs: never, files: (path) => path === name, count: 0 });
  }

  if (searchesFolders(config) && !input.seenByRepository(rootDir)) {
    targets.push(foldersTarget(rootDir, outputDir));
    const roots = [rootDir, ...candidatesUnder(rootDir).filter((dir) => !samePlace(dir, outputDir) && !input.seenByRepository(dir))];
    for (const root of roots) {
      for (const glob of workspaceGlobs(root).filter((each) => !each.startsWith('!'))) {
        const target = memberTarget(root, glob);
        if (target !== undefined) targets.push(target);
      }
    }
  }

  const seen = new Set<string>();
  const listed: Array<readonly ['shapes' | 'patterns', string]> = [
    ...(config.shapes ?? []).map((pattern) => ['shapes', pattern] as const),
    ...(config.patterns ?? []).map((pattern) => ['patterns', pattern] as const),
    ...config.services.flatMap((service) => [
      ...(service.shapes ?? []).map((pattern) => ['shapes', pattern] as const),
      ...(service.patterns ?? []).map((pattern) => ['patterns', pattern] as const),
    ]),
  ];
  for (const [kind, pattern] of listed) {
    const target = fileTarget(kind, rootDir, pattern);
    if (target === undefined) continue;
    const rest = restOf(target.dir, resolve(rootDir, pattern));
    const key = `${kind}\0${toPosixPath(target.dir)}\0${rest}`;
    if (seen.has(key) || seenAlready(target, rest, input)) continue;
    seen.add(key);
    targets.push(target);
  }

  return [...targets, ...sourceTargets(input, targets)];
};

/** The directories a watcher is started on, each once. */
export const rootsOf = (targets: readonly WatchTarget[]): string[] => [...new Set(targets.map((target) => target.dir))].sort();

/** What a path is to the watch: a directory, a file, or not known yet (the watcher has not looked). */
export type PathKind = 'dir' | 'file' | 'unknown';

/**
 * Whether a watcher should look at a path at all: a place watched, or
 * something below one that matters or is on the way to something that does.
 */
export const admits = (targets: readonly WatchTarget[], path: string, kind: PathKind = 'unknown'): boolean =>
  targets.some((target) => {
    if (samePlace(path, target.dir)) return true;
    if (!isBelowDir(path, target.dir)) return false;
    const rest = restOf(target.dir, path);
    return (kind !== 'file' && target.dirs(rest)) || (kind !== 'dir' && target.files(rest));
  });

/** One thing a watcher reports. */
export type WatchEventName = 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir';

/** Why an event matters to the build, by every place it belongs to; empty when it does not. */
export const mattersTo = (
  targets: readonly WatchTarget[],
  event: WatchEventName,
  path: string,
): SurroundingKind[] => {
  const dir = event === 'addDir' || event === 'unlinkDir';
  const kinds = targets.flatMap((target) => {
    if (!isBelowDir(path, target.dir)) return [];
    const rest = restOf(target.dir, path);
    return (dir ? target.dirs(rest) : target.files(rest)) ? [target.kind] : [];
  });
  return [...new Set(kinds)];
};

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** The places beside the repositories, as the line that says what is watched names them. */
const PHRASES: ReadonlyArray<readonly [SurroundingKind, (count: number) => string]> = [
  ['folders', () => 'the directories beside the configuration'],
  ['workspace', (count) => plural(count, 'workspace glob', 'workspace globs')],
  ['shapes', (count) => plural(count, 'shapes entry', 'shapes entries')],
  ['patterns', (count) => plural(count, 'patterns entry', 'patterns entries')],
  ['sources', (count) => plural(count, 'file read from outside them', 'files read from outside them')],
];

/**
 * The line a watch prints once it is watching: the repositories, and what
 * beside them. The configuration and where each repository is are watched
 * too, and go without saying.
 */
export const watchingLine = (repositories: number, targets: readonly WatchTarget[]): string => {
  const parts = [plural(repositories, 'repository', 'repositories')];
  for (const [kind, phrase] of PHRASES) {
    const count = targets.filter((target) => target.kind === kind).reduce((sum, target) => sum + target.count, 0);
    if (count > 0) parts.push(phrase(count));
  }
  const last = parts.pop() as string;
  return `watching ${parts.length === 0 ? last : `${parts.join(', ')} and ${last}`}`;
};
