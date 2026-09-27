import { allDependencies, type PackageJson } from '@flowatlas/core';

/**
 * Which half of a repository a type's reader is the reader of.
 *
 * A repository can honestly be both halves at once - a server and the browser
 * that talks to it, in one directory, sharing one manifest - and this column is
 * the whole of what decides which reader it gets. A server type's reader opens
 * every kind of TypeScript source and hands the browser half to whichever
 * frontend adapter recognises it, so it can answer for both halves of one
 * directory; a browser type's reader can answer for one. So where both halves
 * are declared the reader that reads both wins, and a repository that is only a
 * browser still gets the reader that is only a browser's.
 *
 * Written down rather than left to the order of the rows, which is what it used
 * to be. outline declares Koa and React in one directory and React sat above Koa
 * for a reason that had nothing to do with either, so its data layer, its
 * channels and the bodies behind its routes - 1,197 query sites, 33 channels and
 * 249 handlers of 257 - turned on which of the two rows somebody had typed first
 * (R88). Order can say "the more specific of two servers"; it cannot say "both
 * halves are here", because that is not a fact about either row.
 *
 * `build/extractor.ts` states the same fact in the other direction - which types
 * each reader handles - and `stacks.test.ts` holds the two to each other, so a
 * type that moves from one reader to the other cannot leave this column behind.
 */
type Half = 'server' | 'browser';

/** One row: a type, the dependency that gives it away, and the half it reads. */
type Signature = readonly [type: string, dependency: string, half: Half];

/**
 * Service types `init` and `link` can suggest, and the dependency that gives
 * each one away.
 *
 * The list lives here rather than in the core on purpose: the core must not
 * know the name of any framework, and `type` stays an open string so that a
 * value it has never heard of is still a valid configuration. A repository whose
 * way in is described in configuration rather than declared as a dependency is
 * not in this table at all, for the same reason: nothing here gives it away.
 */
export const TYPE_SIGNATURES: readonly Signature[] = [
  // Within a half, order is specificity and nothing else, and NestJS comes first
  // for that reason: `@nestjs/platform-express` brings Express with it, and a
  // Nest application that declares `express` is a Nest application. Across the
  // halves order decides nothing, which is the point of the column.
  ['nestjs', '@nestjs/core', 'server'],
  // Above Express for the same reason, and above React for a second one: this
  // framework brings Express with it and never registers a route on it - its
  // routes are the paths of its files - and its admin panel is React, so a
  // repository built on it declares two dependencies that both describe
  // something it is not. Read as Express it produced one route of four hundred
  // and eighty-eight; read as React it would lose every query site it has. A
  // dependency is not a stack, and this is the row that says so (R91).
  ['medusa', '@medusajs/framework', 'server'],
  ['medusa', '@medusajs/medusa', 'server'],
  // The file-system router is a server type although it is also a browser: it is
  // both halves in one directory, and the reader that reads both is the server
  // one. It used to earn its place by sitting above `react`; it earns it here by
  // being what it is.
  ['nextjs', 'next', 'server'],
  ['express', 'express', 'server'],
  ['fastify', 'fastify', 'server'],
  ['koa', 'koa', 'server'],
  ['angular', '@angular/core', 'browser'],
  ['react', 'react', 'browser'],
];

const inHalf = (half: Half): readonly Signature[] =>
  TYPE_SIGNATURES.filter(([, , each]) => each === half);

/**
 * The rows in the order the rule asks them: everything that can read both
 * halves, and only then everything that can read one.
 */
const READS_BOTH_FIRST = [...inHalf('server'), ...inHalf('browser')];

/** The half a type's reader reads, for a type this table knows. */
const HALF_OF: Readonly<Record<string, Half>> = Object.freeze(
  Object.fromEntries(TYPE_SIGNATURES.map(([type, , half]) => [type, half])),
);

export const UNKNOWN_TYPE = 'unknown';

/**
 * Frameworks there is no reader for, and the dependency that gives each away.
 *
 * Knowing the name of a stack it cannot read is worth as much as knowing one it
 * can: a repository that contributes nothing to the graph should say which
 * repository and why, rather than leave somebody to work out that half their
 * routes are missing. These are consulted only once `TYPE_SIGNATURES` has found
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
  const half = HALF_OF[type];
  if (half === undefined) return undefined;
  return firstMatch(pkg, inHalf(half === 'server' ? 'browser' : 'server'));
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
 * is usually arranged. PeerTube is that repository: `server/package.json` names
 * a package, a version and an export map of subpaths, and the hundred and
 * thirteen dependencies the server actually has — Express among them — are at
 * the root. Read on its own it gave nothing away, which is why the coverage
 * harness had to be told `server` is an Express service by hand.
 *
 * Narrow on purpose, in both conditions, and the narrowness is what keeps it
 * safe. A member that declares even one dependency has said what it is built on
 * and is taken at its word, so a library with a single dependency does not
 * inherit a framework it never asked for; and one that can be imported by name is
 * a library whatever else is true of it. Every other member of PeerTube's
 * workspace fails one test or the other, so this claims the root's manifest for
 * exactly the directory it belongs to.
 *
 * Widening every member's manifest instead has been measured and it is wrong
 * here. `packages/medusa` declares Express, the monorepo root carries React in
 * its tooling, and the table above ranks React above Express because a repository
 * that declares both is usually the browser half; such a member read from a
 * widened manifest is handed to the browser reader and loses every query site it
 * has. The table is the reason, so the guard belongs beside the table: what a
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
