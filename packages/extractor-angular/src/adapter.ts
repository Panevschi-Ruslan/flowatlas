import { hasDependency, type AdapterRegistry, type FrontendAdapter } from '@flowatlas/core';
import { extractAngular } from './extract-repo.js';

/**
 * The frontend this extractor reads.
 *
 * Recognised by the framework's own package rather than by anything in the
 * source: a repository that depends on it is one of these, and a repository that
 * does not cannot be, whatever its files are called.
 */
export const angularFrontendAdapter: FrontendAdapter = {
  name: 'angular',
  detect: (pkg) => hasDependency(pkg, '@angular/core'),
  extract: (ctx, options) => extractAngular(ctx, options),
};

/** Puts this extractor where the registry can find it, like every other adapter. */
export const registerFrontendAdapters = (registry: AdapterRegistry): AdapterRegistry =>
  registry.register('frontend', angularFrontendAdapter);
