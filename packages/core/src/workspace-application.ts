import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ts } from 'ts-morph';
import { isWithinDir, toPosixPath } from './ids.js';
import { readPackageJson, type PackageJson } from './package-json.js';
import { findTsconfig } from './tsconfig-file.js';

/**
 * An application a workspace builds without giving it a manifest of its own (R180).
 *
 * A workspace of the other kind - one manifest at the root, every dependency
 * declared there, and the applications and libraries under `apps/` and `libs/`
 * as plain directories - is the ordinary layout of a monorepo whose build tool
 * keeps one install for everything. Each application is a TypeScript program of
 * its own: it has its own tsconfig, which extends the root's, and its own entry
 * point. What it does not have is a `package.json`, and to every reader of this
 * tool a directory with no manifest was not a package at all: `link` refused it,
 * and a service configured by hand was read with no dependencies, so no adapter
 * that gates on one was switched on. A workspace of such applications read
 * nothing between them.
 *
 * So the question is asked here, of the files alone and naming no tool: **a
 * directory with no manifest of its own, a tsconfig of its own, and a tsconfig
 * chain that extends one in the nearest directory above it holding a manifest,
 * is an application of that directory's workspace, and is built with its
 * manifest.** The `extends` is the evidence and it is deliberately required. A
 * directory with a tsconfig and no manifest is otherwise only a directory -
 * a deployment's source folder in a repository whose root manifest is for its
 * tooling - and lending it the root's dependencies would switch on readers for
 * frameworks it never runs. A workspace build tool's own description of its
 * projects names the application too, and the command line reads those to name
 * it; the build does not need them, because the tsconfig already says what the
 * build reads.
 *
 * The search upwards stops at the repository's edge, a directory holding `.git`,
 * because a checkout's parents are the machine's business.
 */
export interface WorkspaceApplication {
  /** Absolute path of the application. */
  readonly dir: string;
  /** Absolute path of the directory whose manifest the application is built with. */
  readonly root: string;
  /** Absolute path of the application's own tsconfig. */
  readonly tsconfig: string;
}

/** The most `extends` followed, as the compiler bounds a chain that loops. */
const DEEPEST_EXTENDS = 8;

const readConfig = (path: string): Record<string, unknown> | undefined => {
  const read = ts.readConfigFile(toPosixPath(path), ts.sys.readFile);
  return read.error === undefined && typeof read.config === 'object' && read.config !== null
    ? (read.config as Record<string, unknown>)
    : undefined;
};

/** Every tsconfig a chain of relative `extends` names, starting with the one given. */
const extendsChain = (configPath: string): string[] => {
  const chain: string[] = [];
  const visit = (path: string, depth: number): void => {
    if (depth > DEEPEST_EXTENDS || chain.includes(path)) return;
    const config = readConfig(path);
    if (config === undefined) return;
    chain.push(path);
    const parents = Array.isArray(config['extends']) ? config['extends'] : [config['extends']];
    for (const parent of parents) {
      // A package's tsconfig (`@tsconfig/node20`) is not the workspace's.
      if (typeof parent !== 'string' || !parent.startsWith('.')) continue;
      const next = resolve(dirname(path), parent);
      visit(existsSync(next) ? next : `${next}.json`, depth + 1);
    }
  };
  visit(configPath, 0);
  return chain;
};

/** The nearest directory above `dir`, inside the repository, that holds a manifest. */
const manifestAbove = (dir: string): string | undefined => {
  for (let at = dir; ; ) {
    if (existsSync(join(at, '.git'))) return undefined;
    const parent = dirname(at);
    if (parent === at) return undefined;
    at = parent;
    if (readPackageJson(at) !== undefined) return at;
  }
};

const applications = new Map<string, WorkspaceApplication | undefined>();

/** The workspace application `dir` is, or nothing when it is a package, or no application at all. */
export const workspaceApplicationOf = (dir: string): WorkspaceApplication | undefined => {
  const own = resolve(dir);
  if (applications.has(own)) return applications.get(own);
  const found = ((): WorkspaceApplication | undefined => {
    if (readPackageJson(own) !== undefined) return undefined;
    const tsconfig = findTsconfig(own);
    if (tsconfig === undefined) return undefined;
    const root = manifestAbove(own);
    if (root === undefined) return undefined;
    const extendsRoot = extendsChain(tsconfig).some((path) => isWithinDir(path, root) && !isWithinDir(path, own));
    return extendsRoot ? { dir: own, root, tsconfig } : undefined;
  })();
  applications.set(own, found);
  return found;
};

/**
 * The manifest a service is built with: its own, or, for an application of a
 * workspace, the root's, taken for what it is. Nothing for a directory that is
 * neither - which callers read, as before, as "there is no package here".
 */
export const readServiceManifest = (dir: string): PackageJson | undefined => {
  const own = readPackageJson(dir);
  if (own !== undefined) return own;
  const application = workspaceApplicationOf(dir);
  return application === undefined ? undefined : readPackageJson(application.root);
};

const libraries = new Map<string, readonly string[]>();

/** The directory one `paths` target names: up to its `*`, or the file's own directory. */
const directoryOfTarget = (base: string, target: string): string => {
  const star = target.indexOf('*');
  const written = star === -1 ? target : target.slice(0, star);
  const path = resolve(base, written);
  if (star !== -1) return written.endsWith('/') || written === '' ? path : dirname(path);
  try {
    if (statSync(path).isDirectory()) return path;
  } catch {
    // A target without its extension, `libs/orders/src/index`, names a file.
  }
  return dirname(path);
};

/** Whether one `paths` key names a specifier: exactly, or around its one `*`. */
const aliasMatches = (pattern: string, specifier: string): boolean => {
  const star = pattern.indexOf('*');
  if (star === -1) return pattern === specifier;
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  return specifier.length >= prefix.length + suffix.length && specifier.startsWith(prefix) && specifier.endsWith(suffix);
};

/** The `paths` the application's tsconfig chain declares, each key with the directories it names. */
const aliasesOf = (application: WorkspaceApplication): Array<readonly [string, readonly string[]]> => {
  const config = readConfig(application.tsconfig);
  if (config === undefined) return [];
  const options = ts.parseJsonConfigFileContent(
    config,
    {
      useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: () => [],
    },
    dirname(application.tsconfig),
    undefined,
    application.tsconfig,
  ).options;
  const base = typeof options.pathsBasePath === 'string' ? options.pathsBasePath : (options.baseUrl ?? dirname(application.tsconfig));
  return Object.entries(options.paths ?? {}).map(([pattern, targets]) => [
    pattern,
    targets
      .map((target) => directoryOfTarget(base, target))
      .filter(
        (library) =>
          isWithinDir(library, application.root) &&
          !isWithinDir(library, application.dir) &&
          !isWithinDir(application.dir, library) &&
          !library.split(/[\\/]/).includes('node_modules') &&
          existsSync(library),
      ),
  ]);
};

/** The files whose imports are read, and the directories a walk for them never enters. */
const SCRIPT = /\.(?:[cm]?[jt]sx?)$/;
const NEVER_SOURCE = new Set(['node_modules', 'dist', 'build', 'coverage', 'tmp']);

/** What one import, re-export, `import()` or `require()` names. */
const SPECIFIER = /(?:\bfrom|\bimport|\brequire\s*\()\s*\(?\s*['"]([^'"\n]+)['"]/g;

/**
 * An import or re-export of types alone, which the compiler erases: a library
 * whose types an application names and whose code it never runs is not one it
 * is built from, and reading it would put the library's publishers in a service
 * that only knows the shape of what they send.
 */
const TYPES_ONLY = /\b(?:import|export)\s+type\s*\{[^}]*\}\s*from\s*['"][^'"\n]+['"]|\bimport\s+type\s+[\w$]+\s+from\s*['"][^'"\n]+['"]/g;

/** Every module specifier written in the scripts under `dir`. */
const specifiersUnder = (dir: string): Set<string> => {
  const found = new Set<string>();
  const walk = (at: string): void => {
    let entries;
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || NEVER_SOURCE.has(entry.name)) continue;
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (SCRIPT.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        let text: string;
        try {
          text = readFileSync(path, 'utf8');
        } catch {
          continue;
        }
        for (const match of text.replace(TYPES_ONLY, '').matchAll(SPECIFIER)) if (match[1] !== undefined) found.add(match[1]);
      }
    }
  };
  walk(dir);
  return found;
};

/**
 * The libraries an application of a workspace is built from: the directories its
 * tsconfig's `paths` name that its code imports, and the ones those import in
 * turn, inside the workspace and outside the application.
 *
 * A workspace with one manifest has no other way to say it. A library under
 * `libs/` has no manifest either, so no dependency section can name it; what
 * makes `import { OrderEvents } from '@shop/order-events'` reach
 * `libs/order-events/src` is the alias the root's tsconfig declares and the
 * application's extends. That alias, imported, is to this kind of workspace what
 * a dependency on a member is to the other kind, and it is read the same way:
 * the library's files are part of the service, read and walked like its own,
 * and an edge into one is an edge inside the service rather than a call into a
 * package.
 *
 * Imported, and not merely declared, because here the declaration says nothing:
 * every project extends the one root tsconfig, so every application is declared
 * every library, and reading them all would put each library's publishers into
 * every application of the workspace - a service sending what it never sends.
 * Which aliases are imported is read from the text of the import statements, as
 * the counting rule reads sites, because the program that would answer it
 * exactly is opened only once the extent is known. A target that is the
 * application, holds it, climbs out of the workspace or names an installed
 * package is not a library.
 */
export const applicationLibraryDirs = (dir: string): readonly string[] => {
  const own = resolve(dir);
  const cached = libraries.get(own);
  if (cached !== undefined) return cached;
  const application = workspaceApplicationOf(own);
  const found: string[] = [];
  if (application !== undefined) {
    const aliases = aliasesOf(application);
    const queue = [own];
    while (queue.length > 0) {
      const at = queue.shift() as string;
      for (const specifier of specifiersUnder(at)) {
        for (const [pattern, dirs] of aliases) {
          if (!aliasMatches(pattern, specifier)) continue;
          for (const library of dirs) {
            if (found.includes(library)) continue;
            found.push(library);
            queue.push(library);
          }
        }
      }
    }
  }
  // One inside another is read once, as the outer one.
  const outermost = found
    .filter((library) => !found.some((other) => other !== library && isWithinDir(library, other)))
    .sort();
  libraries.set(own, outermost);
  return outermost;
};

/** Forgets every answer above, for a process that reads the disk again (P206). */
export const forgetWorkspaceApplications = (): void => {
  applications.clear();
  libraries.clear();
};
