import type { PackageJson } from '@flowatlas/core';

/**
 * Service types `init` and `link` can suggest, and the dependency that gives
 * each one away.
 *
 * The list lives here rather than in the core on purpose: the core must not
 * know the name of any framework, and `type` stays an open string so that a
 * value it has never heard of is still a valid configuration.
 */
export const TYPE_SIGNATURES: ReadonlyArray<readonly [type: string, dependency: string]> = [
  ['nestjs', '@nestjs/core'],
  ['angular', '@angular/core'],
];

export const UNKNOWN_TYPE = 'unknown';

/**
 * Frameworks there is no reader for, and the dependency that gives each away.
 *
 * Knowing the name of a stack it cannot read is worth as much as knowing one it
 * can: a repository that contributes nothing to the graph should say which
 * repository and why, rather than leave somebody to work out that half their
 * routes are missing. These are consulted only once `TYPE_SIGNATURES` has found
 * nothing, so a NestJS application is never called Express on the strength of
 * `@nestjs/platform-express` bringing Express with it.
 */
export const UNREAD_SIGNATURES: ReadonlyArray<readonly [framework: string, dependency: string]> = [
  ['Next.js', 'next'],
  ['Nuxt', 'nuxt'],
  ['Remix', '@remix-run/react'],
  ['Express', 'express'],
  ['Fastify', 'fastify'],
  ['Koa', 'koa'],
  ['React', 'react'],
  ['Vue', 'vue'],
  ['Svelte', 'svelte'],
];

/** Everything a manifest declares, wherever it declares it. */
const declaredDeps = (pkg: PackageJson): Record<string, unknown> => ({
  ...pkg.dependencies,
  ...pkg.devDependencies,
  ...pkg.peerDependencies,
  ...pkg.optionalDependencies,
});

/** The first name in a table whose dependency the manifest declares. */
const firstMatch = (
  pkg: PackageJson,
  table: ReadonlyArray<readonly [name: string, dependency: string]>,
): string | undefined => {
  const declared = declaredDeps(pkg);
  for (const [name, dependency] of table) {
    if (Object.hasOwn(declared, dependency)) return name;
  }
  return undefined;
};

/** The type to suggest for a repository, or `unknown` when nothing gave it away. */
export const guessType = (pkg: PackageJson): string =>
  firstMatch(pkg, TYPE_SIGNATURES) ?? UNKNOWN_TYPE;

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
