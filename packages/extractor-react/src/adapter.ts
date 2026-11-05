import { hasDependency, type AdapterRegistry, type FrontendAdapter } from '@flowatlas/core';
import { extractBrowser, extractReact, type BrowserReading } from './extract-repo.js';
import { declaresReact, declaresSvelte, declaresVue } from './framework.js';
import { SVELTE_FORMAT, VUE_FORMAT } from './sfc/formats.js';

/**
 * The frontend this extractor reads.
 *
 * Recognised by the framework's own package (`declaresReact`).
 *
 * One adapter covers the framework and the file-system router built on it,
 * because the second depends on the first and a repository written with it is a
 * React repository that also serves routes. What it serves is read by an entry
 * adapter that detects the second package on its own, so nothing here has to
 * know the difference.
 */
export const reactFrontendAdapter: FrontendAdapter = {
  name: 'react',
  detect: declaresReact,
  extract: (ctx, options) => extractReact(ctx, options),
};

/**
 * Vue and Nuxt (P233): components in `.vue` files, read by this reader's own
 * passes once their scripts are files the checker can open. A Nuxt
 * application's `server/` is the other half, which the server reader reads.
 */
export const VUE_READING: BrowserReading = {
  declares: declaresVue,
  formats: [VUE_FORMAT],
  elsewhere: (base) => (hasDependency(base.pkg, 'nuxt') ? ['server'] : []),
};

/** Svelte (P233): components in `.svelte` files, SvelteKit's among them. */
export const SVELTE_READING: BrowserReading = { declares: declaresSvelte, formats: [SVELTE_FORMAT] };

export const vueFrontendAdapter: FrontendAdapter = {
  name: 'vue',
  detect: declaresVue,
  extract: (ctx, options) => extractBrowser(ctx, options ?? {}, VUE_READING),
};

export const svelteFrontendAdapter: FrontendAdapter = {
  name: 'svelte',
  detect: declaresSvelte,
  extract: (ctx, options) => extractBrowser(ctx, options ?? {}, SVELTE_READING),
};

/** Puts this extractor where the registry can find it, like every other adapter. */
export const registerFrontendAdapters = (registry: AdapterRegistry): AdapterRegistry =>
  registry.register('frontend', reactFrontendAdapter).register('frontend', vueFrontendAdapter).register('frontend', svelteFrontendAdapter);
