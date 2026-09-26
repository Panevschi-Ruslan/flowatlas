import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/**
 * Manifests, and the two different questions asked of them.
 *
 * *What does this package say it is* is answered by its own manifest and by
 * nothing else: its name, and the framework it is built on. That is
 * `readPackageJson`.
 *
 * *What can the code in this directory import* is a wider question, because a
 * package inside a workspace can import what the workspace declared. That is
 * `readResolvedPackageJson`, and it is the one adapter detection asks: every
 * adapter gates on it, so it is answered once, here, and no adapter has to know
 * that a repository might be a package inside a larger tree.
 *
 * Keeping them apart matters in both directions. Asking the narrow question
 * where the wide one belongs switches every adapter off on a workspace member
 * whose leaf manifest is a name and a version. Asking the wide one where the
 * narrow belongs makes a server package look like whatever framework the
 * monorepo around it happens to have in its tooling.
 */

/** The subset of a `package.json` this tool reads. */
export interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * The sections a declaration can sit in, as one list.
 *
 * Which section a name is in says how the package manager should install it and
 * nothing about whether the code imports it, so every reader below walks the
 * same list rather than naming the four sections again.
 */
const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

type DependencySection = (typeof DEPENDENCY_SECTIONS)[number];

/** Every declared dependency, regardless of which section it sits in. */
export const allDependencies = (pkg: PackageJson): Record<string, string> => {
  const declared: Record<string, string> = {};
  for (const section of DEPENDENCY_SECTIONS) Object.assign(declared, pkg[section]);
  return declared;
};

export const hasDependency = (pkg: PackageJson, name: string): boolean =>
  Object.hasOwn(allDependencies(pkg), name);

/** True when any of the names is a declared dependency. */
export const hasAnyDependency = (pkg: PackageJson, names: readonly string[]): boolean => {
  const deps = allDependencies(pkg);
  return names.some((name) => Object.hasOwn(deps, name));
};

/**
 * Reads a directory's own `package.json`, or returns undefined when there is
 * none or it is not valid JSON. Total on purpose: reading a repository must
 * never crash on a tree with an odd layout.
 */
export const readPackageJson = (dir: string): PackageJson | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as PackageJson) : undefined;
  } catch {
    return undefined;
  }
};

// ------------------------------------------------------------------ the chain

/**
 * Which directories a workspace says its packages live in, ready to test paths
 * against.
 *
 * Patterns are relative to the directory that declared them, and a pattern
 * prefixed with `!` takes a directory back out again. They are compiled once
 * here rather than on every path they are asked about, because the walk below
 * asks about every directory in the tree.
 */
interface MemberPatterns {
  readonly include: readonly RegExp[];
  readonly exclude: readonly RegExp[];
  /** How deep a walk has to go to find everything `include` can name. */
  readonly depth: number;
}

const asPatterns = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/**
 * The members a manifest declares, in the two shapes a manifest declares them:
 * a list, or an object with the list under `packages`.
 */
const membersFromManifest = (text: string): readonly string[] => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const declared = (parsed as { workspaces?: unknown }).workspaces;
    if (Array.isArray(declared)) return asPatterns(declared);
    if (typeof declared === 'object' && declared !== null) {
      return asPatterns((declared as { packages?: unknown }).packages);
    }
    return [];
  } catch {
    return [];
  }
};

const unquote = (value: string): string => {
  const trimmed = value.trim();
  const quoted = /^(['"])(.*)\1$/.exec(trimmed);
  return quoted === null ? trimmed : (quoted[2] ?? '');
};

/**
 * The `packages:` list out of a workspace file, and nothing else out of it.
 *
 * Deliberately not a parser for the whole format. The only thing wanted from
 * that file is one list of strings under one top-level key, and reading it by
 * hand keeps this package free of a dependency it would otherwise carry into
 * every build for four lines of data. Anything else in the file - overrides,
 * patches, install settings - is somebody else's business and is skipped by
 * stopping at the next top-level key.
 */
const membersFromWorkspaceFile = (text: string): readonly string[] => {
  const found: string[] = [];
  let inside = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const key = /^packages\s*:(.*)$/.exec(line);
    if (key !== null) {
      // Written inline as a flow sequence rather than as a block list: the same
      // list, spelled the other way the format allows.
      const inline = /^\s*\[(.*)\]\s*$/.exec(key[1] ?? '');
      if (inline !== null) return (inline[1] ?? '').split(',').map(unquote).filter(Boolean);
      inside = true;
      continue;
    }
    if (!inside) continue;
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item !== null) {
      const value = unquote((item[1] ?? '').replace(/\s+#.*$/, ''));
      if (value !== '') found.push(value);
      continue;
    }
    if (line.trim() === '' || line.startsWith('#')) continue;
    // A line that starts in the first column is the next top-level key, which
    // ends the list.
    if (/^\S/.test(line)) break;
  }
  return found;
};

const ESCAPE = /[.*+?^${}()|[\]\\]/g;

/** One member pattern as a test on a path relative to the root that declared it. */
const asTest = (pattern: string): RegExp => {
  const segments = pattern.replace(/\/+$/, '').split('/');
  const source = segments
    .map((segment) =>
      segment === '**'
        ? '.*'
        : segment
            .split('*')
            .map((literal) => literal.replace(ESCAPE, '\\$&'))
            .join('[^/]*'),
    )
    .join('/');
  return new RegExp(`^${source}$`);
};

const matches = (patterns: MemberPatterns, path: string): boolean =>
  patterns.include.some((test) => test.test(path)) &&
  !patterns.exclude.some((test) => test.test(path));

/**
 * How deep a walk has to go to find every member these patterns can name.
 *
 * The patterns themselves say: `packages/*` cannot match anything three levels
 * down. `**` has no depth of its own, so it is given a couple of levels beyond
 * the rest of its pattern rather than licence to walk a whole checkout.
 */
const depthLimit = (include: readonly string[]): number => {
  let limit = 0;
  for (const pattern of include) {
    const segments = pattern.split('/').length;
    limit = Math.max(limit, pattern.includes('**') ? segments + 2 : segments);
  }
  return limit;
};

/**
 * Where a workspace root declares its members.
 *
 * A table rather than a run of branches: one entry per file that can carry the
 * declaration, and both are read when both exist, because a repository is
 * allowed to say it in either place and saying it in one does not make the other
 * a lie.
 */
interface MemberSource {
  readonly file: string;
  readonly read: (text: string) => readonly string[];
}

const MEMBER_SOURCES: readonly MemberSource[] = [
  { file: 'pnpm-workspace.yaml', read: membersFromWorkspaceFile },
  { file: 'package.json', read: membersFromManifest },
];

/** The members a directory declares, or nothing when it is not a workspace root. */
const declaredMembers = (dir: string): MemberPatterns | undefined => {
  const patterns: string[] = [];
  for (const source of MEMBER_SOURCES) {
    let text: string;
    try {
      text = readFileSync(join(dir, source.file), 'utf8');
    } catch {
      continue;
    }
    patterns.push(...source.read(text));
  }
  if (patterns.length === 0) return undefined;
  const cleaned = patterns.map((pattern) => pattern.replace(/\\/g, '/').replace(/^\.\//, ''));
  const include = cleaned.filter((pattern) => !pattern.startsWith('!'));
  return {
    include: include.map(asTest),
    exclude: cleaned
      .filter((pattern) => pattern.startsWith('!'))
      .map((pattern) => asTest(pattern.slice(1))),
    depth: depthLimit(include),
  };
};

const childDirectories = (dir: string): readonly string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      // Installed packages are not members of the workspace, and a dot
      // directory is tooling rather than source. Both are also where the walk
      // would spend all of its time.
      .filter((name) => name !== 'node_modules' && !name.startsWith('.'));
  } catch {
    return [];
  }
};

const toPosix = (path: string): string => path.replace(/\\/g, '/');

/** The members of a workspace rooted at `dir`, as paths relative to it. */
const memberDirs = (dir: string, patterns: MemberPatterns): readonly string[] => {
  const found: string[] = [];
  const visit = (path: string, depth: number): void => {
    for (const name of childDirectories(join(dir, path))) {
      const child = path === '' ? name : `${path}/${name}`;
      if (matches(patterns, child)) found.push(child);
      if (depth < patterns.depth) visit(child, depth + 1);
    }
  };
  visit('', 1);
  return found;
};

/** The workspace roots this directory is a package of, nearest first. */
const rootsAbove = (dir: string): readonly string[] => {
  const found: string[] = [];
  let current = dirname(dir);
  let previous = dir;
  // Up to the top of the file system. Nothing shorter is right: a checkout can
  // sit at any depth, and an ancestor only counts when it names this directory,
  // which an unrelated one has no way to do by accident.
  while (current !== previous) {
    const patterns = declaredMembers(current);
    if (patterns !== undefined && matches(patterns, toPosix(relative(current, dir)))) {
      found.push(current);
    }
    previous = current;
    current = dirname(current);
  }
  return found;
};

/**
 * Every manifest that governs what the code in a directory may import, nearest
 * to the directory last.
 *
 * Two directions, one fact: a dependency declared anywhere in the workspace a
 * directory belongs to is a dependency the code being read can use.
 *
 * Upwards, because a package inside a workspace resolves what the root declared:
 * a leaf manifest that is a name, a version and an exports map is the normal
 * shape of a workspace member, not the shape of a package that depends on
 * nothing, and reading only that leaf is how a repository with hundreds of
 * routes and a hundred tables comes back empty.
 *
 * Downwards, because when the directory handed to this tool is itself a
 * workspace root, the source files of its members are inside it and are read as
 * part of it. What they declare is therefore part of what this read depends on -
 * a monorepo root whose own manifest carries nothing but tooling is otherwise
 * read as a repository with no framework in it at all.
 */
const manifestChain = (dir: string): readonly PackageJson[] => {
  const above = [...rootsAbove(dir)].reverse();
  const patterns = declaredMembers(dir);
  const below = patterns === undefined ? [] : memberDirs(dir, patterns).map((rel) => join(dir, rel));
  return [...above, ...below]
    .map(readPackageJson)
    .filter((pkg): pkg is PackageJson => pkg !== undefined);
};

/**
 * The same manifest, with its dependency sections widened to everything the
 * workspace around the directory declares.
 *
 * The directory's own declaration wins, so a version pinned here still reads as
 * pinned here, and everything else about the manifest - the name above all -
 * belongs to this package alone and is left as it was.
 *
 * A directory with no manifest of its own still returns nothing, rather than the
 * workspace's dependencies under no name: callers use that to mean there is no
 * package here, which is a different question and still has the same answer.
 */
export const readResolvedPackageJson = (dir: string): PackageJson | undefined => {
  const own = readPackageJson(dir);
  if (own === undefined) return undefined;
  const chain = manifestChain(dir);
  if (chain.length === 0) return own;
  const widened: Partial<Record<DependencySection, Record<string, string>>> = {};
  for (const section of DEPENDENCY_SECTIONS) {
    const merged: Record<string, string> = {};
    for (const pkg of chain) Object.assign(merged, pkg[section]);
    Object.assign(merged, own[section]);
    if (Object.keys(merged).length > 0) widened[section] = merged;
  }
  return { ...own, ...widened };
};
