import { allDependencies, type PackageJson } from '@flowatlas/core';

/**
 * Service types `init` and `link` can suggest, and the dependency that gives
 * each one away.
 *
 * The list lives here rather than in the core on purpose: the core must not
 * know the name of any framework, and `type` stays an open string so that a
 * value it has never heard of is still a valid configuration.
 */
export const TYPE_SIGNATURES: ReadonlyArray<readonly [type: string, dependency: string]> = [
  // Order matters, and NestJS comes first for a reason: `@nestjs/platform-express`
  // brings Express with it, and a Nest application that declares `express` is a
  // Nest application. The first match wins, so the most specific goes first.
  ['nestjs', '@nestjs/core'],
  ['angular', '@angular/core'],
  // Above both Express and React, and for the same reason NestJS is above
  // Express: this framework brings Express with it and never registers a route
  // on it — its routes are the paths of its files — and its admin panel is
  // React, so a repository built on it declares two dependencies that both
  // describe something it is not. Read as Express it produced one route of four
  // hundred and eighty-eight; read as React it would lose every query site it
  // has. A dependency is not a stack, and this is the row that says so (R91).
  ['medusa', '@medusajs/framework'],
  ['medusa', '@medusajs/medusa'],
  // Before `react`, and for the same reason NestJS comes before Express: a
  // repository built on the file-system router declares both, and it is the
  // more specific of the two. Reading it as plain React would find its screens
  // and its requests and none of the routes it answers.
  ['nextjs', 'next'],
  ['react', 'react'],
  ['express', 'express'],
  ['fastify', 'fastify'],
  ['koa', 'koa'],
];

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
  table: ReadonlyArray<readonly [name: string, dependency: string]>,
): string | undefined => {
  const declared = allDependencies(pkg);
  for (const [name, dependency] of table) {
    if (Object.hasOwn(declared, dependency)) return name;
  }
  return undefined;
};

/** The type to suggest for a repository, or `unknown` when nothing gave it away. */
export const guessType = (pkg: PackageJson): string =>
  firstMatch(pkg, TYPE_SIGNATURES) ?? UNKNOWN_TYPE;

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
 */
export const noReaderNote = (pkg: PackageJson | undefined): string | undefined => {
  if (pkg === undefined) return undefined;
  const readable = guessType(pkg);
  if (readable !== UNKNOWN_TYPE) return `looks like ${readable}; set its type to "${readable}"`;
  const framework = guessUnread(pkg);
  return framework === undefined ? undefined : `${framework}, no reader yet`;
};
