/**
 * Which directory on disk is which package, by the name it is imported by (P78).
 *
 * A clone with nothing installed still has, one directory over, the source of
 * the internal packages it imports: a library that is itself a repository the
 * project reads, or a workspace member of one. The importer wrote the package's
 * `name`, and the manifest of that directory says the same name, so the two
 * meet on that word and on nothing else - not a directory's name, not the last
 * segment of a scoped one (D1).
 *
 * Two tiers, strongest first: the configured repositories and the workspace
 * members inside them, then the directories directly under the configuration
 * (and the members of a workspace kept there). A name two directories of one
 * tier both claim is answered by neither and said to be ambiguous; a tier never
 * breaks another's tie, because the weaker answer is the one less likely to be
 * what the importer runs.
 */
import { readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { readPackageJson } from './package-json.js';
import { forgetWorkspaces, workspaceGlobs, workspacePackages } from './workspace.js';
import { WORK_COUNTS } from './work-counts.js';

/** Where a package's directory was found: a configured repository, a member of one, or a directory under the configuration. */
export type PackageSourceOrigin = 'service' | 'member' | 'folder';

/** One package whose source is on disk. */
export interface PackageSource {
  /** The name it is imported by, from its manifest. */
  readonly name: string;
  /** Absolute path of the directory holding its manifest. */
  readonly dir: string;
  /** Its manifest's `version`, when it states one. */
  readonly version?: string;
  /** The manifest, for the way in (`exports`, `types`, `typings`, `main`). */
  readonly manifest: Readonly<Record<string, unknown>>;
  /** The configured service whose repository is or holds it; absent for a directory nobody configured. */
  readonly service?: string;
  readonly origin: PackageSourceOrigin;
}

/** Package names to their source, with the names more than one directory claims kept apart. */
export interface PackageIndex {
  readonly sources: ReadonlyMap<string, PackageSource>;
  /** Names two or more directories of the strongest tier that names them both claim. */
  readonly ambiguous: ReadonlyMap<string, readonly PackageSource[]>;
}

export interface PackageIndexInput {
  /** Every configured repository, by service name and absolute directory. */
  readonly services: ReadonlyArray<{ readonly name: string; readonly dir: string }>;
  /** A directory whose direct children are searched too: the configuration's own. */
  readonly folders?: string;
}

/** Directories a search under the configuration never takes for a package (a watch skips them too, P206). */
export const NEVER_A_SOURCE: ReadonlySet<string> = new Set(['node_modules', 'dist', 'build', 'coverage', 'tmp']);

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

const sourceAt = (
  dir: string,
  origin: PackageSourceOrigin,
  service: string | undefined,
): PackageSource | undefined => {
  const manifest = readPackageJson(dir);
  const name = text(manifest?.name);
  if (manifest === undefined || name === undefined) return undefined;
  const version = text(manifest.version);
  return {
    name,
    dir: resolve(dir),
    manifest,
    origin,
    ...(version === undefined ? {} : { version }),
    ...(service === undefined ? {} : { service }),
  };
};

/** A directory's own package and, when it is a workspace root, every member of it. */
const packagesIn = (
  dir: string,
  origin: PackageSourceOrigin,
  service: string | undefined,
): PackageSource[] => {
  const own = sourceAt(dir, origin, service);
  const members =
    workspaceGlobs(dir).length === 0
      ? []
      : workspacePackages(dir).flatMap((pkg) =>
          resolve(pkg.dir) === resolve(dir) ? [] : (sourceAt(pkg.dir, origin === 'folder' ? 'folder' : 'member', service) ?? []),
        );
  return [...(own === undefined ? [] : [own]), ...members];
};

const childDirectories = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !NEVER_A_SOURCE.has(entry.name))
      .map((entry) => join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
};

/** One tier's candidates folded by name: one directory answers, more are ambiguous. */
const byName = (
  candidates: readonly PackageSource[],
): { sources: Map<string, PackageSource>; ambiguous: Map<string, PackageSource[]> } => {
  const grouped = new Map<string, PackageSource[]>();
  for (const candidate of candidates) {
    const list = grouped.get(candidate.name) ?? [];
    if (!list.some((seen) => seen.dir === candidate.dir)) list.push(candidate);
    grouped.set(candidate.name, list);
  }
  const sources = new Map<string, PackageSource>();
  const ambiguous = new Map<string, PackageSource[]>();
  for (const [name, list] of grouped) {
    if (list.length === 1) sources.set(name, list[0] as PackageSource);
    else ambiguous.set(name, [...list].sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0)));
  }
  return { sources, ambiguous };
};

const INDEXES = new Map<string, PackageIndex>();

/**
 * Every package whose source is on disk, by name (P78).
 *
 * Read from manifests alone - `name`, `version` and the fields that say where
 * the package is entered - and remembered for the process, because every
 * service of a build asks the same question of the same directories. A caller
 * in a process that outlives the disk it read (the MCP server, asking what a
 * rebuild would cover) passes `remember: false` and is answered from the disk
 * as it is now (P125).
 */
export const packageIndexOf = (
  input: PackageIndexInput,
  { remember = true }: { readonly remember?: boolean } = {},
): PackageIndex => {
  const key = JSON.stringify([input.services.map((service) => [service.name, service.dir]), input.folders ?? null]);
  const known = remember ? INDEXES.get(key) : undefined;
  if (known !== undefined) return known;
  // A workspace's members are remembered too; asked of the disk as it is now,
  // they are walked again with it (P206).
  if (!remember) forgetWorkspaces();
  WORK_COUNTS.packageIndexes += 1;

  const strong = input.services.flatMap((service) => packagesIn(service.dir, 'service', service.name));
  const taken = new Set(strong.map((pkg) => pkg.dir));
  const weak =
    input.folders === undefined
      ? []
      : [input.folders, ...childDirectories(input.folders)]
          .flatMap((dir) =>
            resolve(dir) === resolve(input.folders as string)
              ? packagesIn(dir, 'folder', undefined).filter((pkg) => pkg.dir !== resolve(dir))
              : packagesIn(dir, 'folder', undefined),
          )
          .filter((pkg) => !taken.has(pkg.dir));

  const first = byName(strong);
  const second = byName(weak);
  const sources = new Map(first.sources);
  const ambiguous = new Map<string, readonly PackageSource[]>(first.ambiguous);
  for (const [name, source] of second.sources) {
    if (!sources.has(name) && !ambiguous.has(name)) sources.set(name, source);
  }
  for (const [name, list] of second.ambiguous) {
    if (!sources.has(name) && !ambiguous.has(name)) ambiguous.set(name, list);
  }
  const index: PackageIndex = { sources, ambiguous };
  if (remember) INDEXES.set(key, index);
  return index;
};

/**
 * Forgets every index this process remembered (P82): the one memo of disk
 * facts a later reading in the same process must not be served from once the
 * disk may have moved. A build hands its readers the index it made instead.
 */
export const forgetPackageIndexes = (): void => {
  INDEXES.clear();
};

/** A configured repository's absolute directory, the way the configuration resolves it. */
export const serviceDirOf = (configDir: string, repo: string): string =>
  isAbsolute(repo) ? repo : resolve(configDir, repo);

/* ── Whether a source's version is one the importer asked for ── */

type Version = readonly [number, number, number];

const versionOf = (written: string): Version | undefined => {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(written.trim());
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
};

const compare = (a: Version, b: Version): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** One comparator of a range, as a test; undefined when it is not one this reads. */
const comparatorTest = (written: string): ((v: Version) => boolean) | undefined => {
  const part = written.trim();
  if (part === '' || part === '*' || part === 'x' || part === 'X' || part === 'latest') return () => true;
  const op = /^(\^|~|>=|<=|>|<|=)?\s*(.*)$/.exec(part);
  if (op === null) return undefined;
  const [, sign = '', rest = ''] = op;
  const pieces = rest.replace(/^v/, '').split('.');
  const wild = (piece: string | undefined): boolean => piece === undefined || piece === '' || /^[xX*]$/.test(piece);
  if (!/^\d+$/.test(pieces[0] ?? '') && !wild(pieces[0])) return undefined;
  const at = versionOf(rest);
  if (at === undefined) return wild(pieces[0]) ? () => true : undefined;
  const fixed = wild(pieces[1]) ? 1 : wild(pieces[2]) ? 2 : 3;
  const upper = (by: number): Version =>
    by === 0 ? [at[0] + 1, 0, 0] : by === 1 ? [at[0], at[1] + 1, 0] : [at[0], at[1], at[2] + 1];
  switch (sign) {
    case '^': {
      const by = at[0] !== 0 || fixed === 1 ? 0 : at[1] !== 0 || fixed === 2 ? 1 : 2;
      return (v) => compare(v, at) >= 0 && compare(v, upper(by)) < 0;
    }
    case '~':
      return (v) => compare(v, at) >= 0 && compare(v, upper(fixed === 1 ? 0 : 1)) < 0;
    case '>=':
      return (v) => compare(v, at) >= 0;
    case '>':
      return (v) => (fixed === 3 ? compare(v, at) > 0 : compare(v, upper(fixed - 1)) >= 0);
    case '<=':
      return (v) => (fixed === 3 ? compare(v, at) <= 0 : compare(v, upper(fixed - 1)) < 0);
    case '<':
      return (v) => compare(v, at) < 0;
    default:
      return fixed === 3 ? (v) => compare(v, at) === 0 : (v) => compare(v, at) >= 0 && compare(v, upper(fixed - 1)) < 0;
  }
};

/**
 * Whether a version is inside a range as a manifest writes one, or undefined
 * when the range is not one this reads (a path, a tag, a URL, an alias).
 *
 * Enough of the range syntax for the question "is the source on disk the
 * version this manifest asked for": `||`, comparator sets, `^`, `~`, the
 * inequalities, `x` ranges, hyphen ranges and the workspace protocol.
 */
export const rangeIncludes = (range: string, version: string): boolean | undefined => {
  const at = versionOf(version);
  if (at === undefined) return undefined;
  let written = range.trim();
  if (written.startsWith('workspace:')) {
    written = written.slice('workspace:'.length);
    if (written === '*' || written === '^' || written === '~' || written === '') return true;
  }
  if (/^(file|link|portal|git|git\+|github|http|https|npm):/.test(written) || written.includes('/')) return undefined;
  let any = false;
  for (const alternative of written.split('||')) {
    const hyphen = /^\s*(\S+)\s+-\s+(\S+)\s*$/.exec(alternative);
    const comparators = hyphen === null ? alternative.trim().split(/\s+/) : [`>=${hyphen[1]}`, `<=${hyphen[2]}`];
    const tests = comparators.map(comparatorTest);
    if (tests.some((test) => test === undefined)) return undefined;
    if (tests.every((test) => (test as (v: Version) => boolean)(at))) any = true;
  }
  return any;
};
