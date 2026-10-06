import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { allDependencies, readPackageJson, type PackageJson } from '@flowatlas/core';
import { terraformReader, unreadDeploymentOf } from '@flowatlas/terraform';
import { halfOf, rowsInHalf, type ReaderRow } from './readers.js';

/**
 * The rows in the order the rule asks them: everything that can read both
 * halves, and only then everything that can read one.
 *
 * A repository can honestly be both halves at once - a server and the browser
 * that talks to it, in one directory, sharing one manifest - and which half a
 * type's reader reads is the whole of what decides which reader it gets. Where
 * both halves are declared the reader that reads both wins, and a repository
 * that is only a browser still gets the reader that is only a browser's.
 *
 * That fact is declared once, in `readers.ts`, beside the reader it follows
 * from; this file asks that table and restates nothing out of it, which is what
 * it used to do (R118). And it is asked rather than left to the order of the
 * rows, which is what it used to be: a wiki app declares Koa and React in one
 * directory and React sat above Koa for a reason that had nothing to do with
 * either, so its data layer, its channels and the bodies behind its routes -
 * 1,197 query sites, 33 channels and 249 handlers of 257 - turned on which of the
 * two rows somebody had typed first (R88). Order can say "the more specific of
 * two servers"; it cannot say "both halves are here", because that is not a fact
 * about either row.
 */
const READS_BOTH_FIRST: readonly ReaderRow[] = [...rowsInHalf('server'), ...rowsInHalf('browser')];

export const UNKNOWN_TYPE = 'unknown';

/**
 * Frameworks there is no reader for, and the dependency that gives each away.
 *
 * Knowing the name of a stack it cannot read is worth as much as knowing one it
 * can: a repository that contributes nothing to the graph should say which
 * repository and why, rather than leave somebody to work out that half their
 * routes are missing. These are consulted only once `READERS` has found
 * nothing, so a repository whose framework is read is never named here on the
 * strength of a second dependency it happens to declare.
 */
export const UNREAD_SIGNATURES: ReadonlyArray<readonly [framework: string, dependency: string]> = [
  // The file-system routers that are left. What they have in common with the two
  // that are now read is that the path a route is served at is the path of the
  // file declaring it — a different fact from a call with a path in it — and by
  // now that part is a row of data rather than a reader (`fs-routes.ts`). What
  // they do not have in common with them is the language the rest is written in,
  // which is what would have to be read next.
  ['Nuxt', 'nuxt'],
  ['Remix', '@remix-run/react'],
  ['Vue', 'vue'],
  ['Svelte', 'svelte'],
];

/** The first name in a table whose dependency the manifest declares. */
const firstMatch = (
  pkg: PackageJson,
  table: ReadonlyArray<readonly [name: string, dependency: string, ...rest: unknown[]]>,
): string | undefined => {
  const declared = allDependencies(pkg);
  for (const [name, dependency] of table) {
    if (Object.hasOwn(declared, dependency)) return name;
  }
  return undefined;
};

/**
 * The type to suggest for a repository, or `unknown` when nothing gave it away.
 *
 * One reader per repository, chosen by a rule a reader can predict: if there is
 * a server here, the type is the server's, because that reader reads the browser
 * half too. Two readers over one directory was the alternative and it is worse -
 * the server reader already reads the browser half through the frontend
 * adapters, so a second reading would be the same screens twice and two graphs
 * of one repository to reconcile, for nothing either of them found alone.
 */
export const guessType = (pkg: PackageJson): string =>
  firstMatch(pkg, READS_BOTH_FIRST) ?? UNKNOWN_TYPE;

/**
 * The half a manifest declares beside the one its guessed type reads, if any.
 *
 * What makes a repository the case this rule exists for, and the only thing that
 * can explain the guess to somebody who can see both names in the manifest.
 */
const otherHalf = (pkg: PackageJson, type: string): string | undefined => {
  const half = halfOf(type);
  if (half === undefined) return undefined;
  return firstMatch(pkg, rowsInHalf(half === 'server' ? 'browser' : 'server'));
};

/** Keys by which a package offers itself to be imported under its name. */
const ENTRY_POINT_KEYS = ['main', 'module', 'browser', 'bin'] as const;

/**
 * Whether a package is something other packages import by name.
 *
 * The one distinction in a workspace that is written down rather than inferred:
 * a library says how to enter it, and an application does not, because nothing
 * imports an application. A `"."` export is the modern spelling of `main` and
 * counts the same; an export map of subpaths only — `{"./*": …}`, which is how a
 * server that is compiled in place but never imported as a whole is spelled —
 * does not, because there is no whole to import.
 */
const importableByName = (pkg: PackageJson): boolean => {
  if (ENTRY_POINT_KEYS.some((key) => pkg[key] !== undefined)) return true;
  const exported = pkg['exports'];
  if (typeof exported === 'string') return true;
  return typeof exported === 'object' && exported !== null && '.' in exported;
};

/**
 * The type to suggest for one member of a workspace.
 *
 * A member that declares no dependency of its own and offers nothing to be
 * imported is not a library that forgot to say what it needs; it is an
 * application whose dependencies are kept in the workspace root, which is how a
 * repository with one deployable server and a pile of small packages beside it
 * is usually arranged. A video platform is that repository: `server/package.json` names
 * a package, a version and an export map of subpaths, and the hundred and
 * thirteen dependencies the server actually has — Express among them — are at
 * the root. Read on its own it gave nothing away, which is why the coverage
 * harness had to be told `server` is an Express service by hand.
 *
 * Narrow on purpose, in both conditions, and the narrowness is what keeps it
 * safe. A member that declares even one dependency has said what it is built on
 * and is taken at its word, so a library with a single dependency does not
 * inherit a framework it never asked for; and one that can be imported by name is
 * a library whatever else is true of it. Every other member of a video platform's
 * workspace fails one test or the other, so this claims the root's manifest for
 * exactly the directory it belongs to.
 *
 * Widening every member's manifest instead has been measured and it is wrong
 * here. A commerce monorepo's server package declares Express, its root carries React in
 * its tooling, and the table this reads ranked React above Express because a
 * repository that declares both is usually the browser half; such a member read
 * from a widened manifest is handed to the browser reader and loses every query
 * site it has. The table is the reason, so the guard belongs beside it: what a
 * service is built on is answered from the manifest of the service, and the root
 * is consulted only where the service's own manifest says nothing whatsoever.
 *
 * That example's own case is now answered a step earlier — the member declares
 * the framework it is built on and the table names it above both the dependencies
 * it brings with it (R91) — so the measurement stands as the reason and not as a
 * live symptom. The next member with two readable dependencies and nothing of its
 * own will be the one this guard is for.
 */
export const guessWorkspaceType = (pkg: PackageJson, root: PackageJson | undefined): string => {
  const own = guessType(pkg);
  if (own !== UNKNOWN_TYPE || root === undefined) return own;
  if (importableByName(pkg) || Object.keys(allDependencies(pkg)).length > 0) return own;
  return guessType(root);
};

/**
 * Whether a workspace member is one of the workspace's applications.
 *
 * What makes a directory a service is that there is something here that can read
 * it. A workspace holds both kinds of package and the question `init` has to
 * answer is which of them somebody would point this tool at; naming a library
 * as a service of its own would read its code twice, once on its own account and
 * once for every application that calls it.
 */
export const looksLikeApplication = (pkg: PackageJson, root: PackageJson | undefined): boolean =>
  guessWorkspaceType(pkg, root) !== UNKNOWN_TYPE;

/**
 * The framework a repository is built on when there is no reader for it.
 *
 * `undefined` means the manifest gave nothing away, which is a different
 * sentence to say and a different thing to do about it.
 */
export const guessUnread = (pkg: PackageJson): string | undefined =>
  firstMatch(pkg, UNREAD_SIGNATURES);

/**
 * What `build` says about a repository it did not read.
 *
 * Two different sentences, because there are two different reasons. A
 * repository whose manifest declares a framework this does read has a `type` in
 * the configuration that does not name it — a typo, or a value from before the
 * reader existed — and the fix is one word in a file. Only when nothing
 * readable is declared is the answer that there is no reader, and saying the
 * second where the first is true sends somebody away from a project the tool
 * could have read in full.
 *
 * A repository that declares both halves gets the reason as well as the word,
 * because the word on its own reads like a mistake: somebody looking at a
 * manifest with two frameworks in it has no way to tell why this is the one to
 * write, and the naming of the other half is what says the choice was made
 * rather than stumbled into.
 */
export const noReaderNote = (pkg: PackageJson | undefined): string | undefined => {
  if (pkg === undefined) return undefined;
  const readable = guessType(pkg);
  if (readable !== UNKNOWN_TYPE) {
    const other = otherHalf(pkg, readable);
    const because =
      other === undefined
        ? ''
        : ` (it declares ${other} as well, and the ${readable} reader reads both halves)`;
    return `looks like ${readable}; set its type to "${readable}"${because}`;
  }
  const framework = guessUnread(pkg);
  return framework === undefined ? undefined : `${framework}, no reader yet`;
};

/** Directories never searched for a manifest of their own. */
const NOT_NESTED = new Set(['node_modules', 'dist', 'build', 'coverage', 'cdk.out', '.terraform']);

/**
 * Manifests below a directory that no workspace declares, nearest first.
 *
 * A repository of Lambda handlers often keeps one `package.json` per function,
 * each with its own dependencies and no workspace tying them together, and its
 * root - if it has a manifest at all - names none of them. Those manifests are
 * the only place such a repository says what it is built on (P21). Bounded in
 * depth, and asked only when the directory's own manifest gave nothing away.
 */
export const nestedManifests = (dir: string, depth = 4): PackageJson[] => {
  const out: PackageJson[] = [];
  const walk = (at: string, level: number): void => {
    if (level > depth) return;
    let entries;
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || NOT_NESTED.has(entry.name)) continue;
      const child = join(at, entry.name);
      if (existsSync(join(child, 'package.json'))) {
        const pkg = readPackageJson(child);
        if (pkg !== undefined) out.push(pkg);
      }
      walk(child, level + 1);
    }
  };
  walk(dir, 1);
  return out;
};

/** The type a deployment description gives a repository away as, when one does. */
const DEPLOYED_TYPE = 'lambda';

/** Whether a directory holds infrastructure that declares a function or a route. */
export const declaresDeployment = (dir: string): boolean => terraformReader.declares(dir);

/**
 * The type to suggest for a directory, asking more than its manifest.
 *
 * The manifest first, as everywhere, then the manifests of the packages below it
 * that no workspace declares, then the files that describe how it is deployed.
 * The last two are what a repository of functions has instead of a framework:
 * a manifest per function, or none at all beside its Terraform.
 */
export const guessDirectoryType = (
  dir: string,
  pkg: PackageJson | undefined,
  root: PackageJson | undefined,
): string => {
  const own = guessWorkspaceType(pkg ?? {}, root);
  if (own !== UNKNOWN_TYPE) return own;
  for (const nested of nestedManifests(dir)) {
    const found = guessType(nested);
    if (found !== UNKNOWN_TYPE) return found;
  }
  return declaresDeployment(dir) ? DEPLOYED_TYPE : UNKNOWN_TYPE;
};

/** The stack a directory is built on when nothing here reads it, from its manifest or its files. */
export const guessUnreadIn = (dir: string, pkg: PackageJson | undefined): string | undefined =>
  (pkg === undefined ? undefined : guessUnread(pkg)) ?? unreadDeploymentOf(dir);
