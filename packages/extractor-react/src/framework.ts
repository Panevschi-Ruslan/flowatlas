import { hasAnyDependency, hasDependency, type PackageJson } from '@flowatlas/core';

/**
 * Whether a manifest declares the framework this extractor reads.
 *
 * Recognised by the framework's own package rather than by anything in the
 * source: a repository that depends on it is one of these, and a repository
 * that does not cannot be, whatever its files are called.
 *
 * Asked twice and written once. The adapter asks it of a service's widened
 * manifest, to decide whether this reader runs at all; the reader asks it of
 * each package the service is made of, through `suppliedWith`, to decide which
 * files it reads once it does (R145). Two spellings of it would be two answers
 * to what this framework is.
 */
export const declaresReact = (pkg: PackageJson): boolean => hasDependency(pkg, 'react');

/** Vue, and Nuxt built on it (P233). */
export const declaresVue = (pkg: PackageJson): boolean => hasAnyDependency(pkg, ['vue', 'nuxt']);

/** Svelte, and SvelteKit built on it (P233). */
export const declaresSvelte = (pkg: PackageJson): boolean => hasDependency(pkg, 'svelte');

/**
 * The type a configuration gives plain browser code (P284): pages and the
 * scripts they load, with no manifest and no framework. Nothing in a manifest
 * gives it away, so it is never guessed from one; `link` and `init` offer it
 * for a directory of pages and scripts that has none.
 */
export const PLAIN_BROWSER_TYPE = 'browser';

/** The adapter that reads such a directory, which only its type chooses. */
export const PLAIN_BROWSER_ADAPTER = 'browser';

/**
 * The adapters a service is read with, by its type: a service of the plain
 * browser type is read by the plain adapter alone unless the configuration
 * forces another, because no manifest can say it is one.
 */
export const forcedFor = <F extends { readonly frontend?: readonly string[] }>(type: string | undefined, force: F): F =>
  type === PLAIN_BROWSER_TYPE && force.frontend === undefined ? { ...force, frontend: [PLAIN_BROWSER_ADAPTER] } : force;
