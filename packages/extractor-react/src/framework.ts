import { hasDependency, type PackageJson } from '@flowatlas/core';

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
