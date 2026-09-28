import { hasDependency, type PackageJson } from '@flowatlas/core';

/**
 * Whether a manifest declares the framework this extractor reads.
 *
 * Recognised by the framework's own package rather than by anything in the
 * source: a repository that depends on it is one of these, and a repository
 * that does not cannot be, whatever its files are called.
 *
 * Asked twice and written once, as the sibling reader does with its own. The
 * adapter asks it of a service's widened manifest, to decide whether this
 * reader runs at all; the reader asks it of each package the service is made
 * of, through `suppliedWith`, to decide which files it reads once it does
 * (R145, R159).
 */
export const declaresAngular = (pkg: PackageJson): boolean => hasDependency(pkg, '@angular/core');
