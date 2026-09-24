import { hasDependency, type AdapterRegistry, type FrontendAdapter } from '@flowatlas/core';
import { extractReact } from './extract-repo.js';

/**
 * The frontend this extractor reads.
 *
 * Recognised by the framework's own package rather than by anything in the
 * source: a repository that depends on it is one of these, and a repository
 * that does not cannot be, whatever its files are called.
 *
 * One adapter covers the framework and the file-system router built on it,
 * because the second depends on the first and a repository written with it is a
 * React repository that also serves routes. What it serves is read by an entry
 * adapter that detects the second package on its own, so nothing here has to
 * know the difference.
 */
export const reactFrontendAdapter: FrontendAdapter = {
  name: 'react',
  detect: (pkg) => hasDependency(pkg, 'react'),
  extract: (ctx, options) => extractReact(ctx, options),
};

/** Puts this extractor where the registry can find it, like every other adapter. */
export const registerFrontendAdapters = (registry: AdapterRegistry): AdapterRegistry =>
  registry.register('frontend', reactFrontendAdapter);
