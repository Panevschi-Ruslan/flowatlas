/**
 * Extractor for repositories built on the React framework.
 *
 * Everything framework-specific lives here: what makes a function a component,
 * how a click is spelled in markup, which spellings reach the network. The core
 * knows none of it and reaches this package only through the adapter registry.
 *
 * What it concludes is the same as what the other front-end reader concludes —
 * a request joined to the route that answers it, and an `impact` that ends at
 * the screen which decided the address. That was always meant to be
 * framework-independent, and this package is the proof that it is.
 */

export { reactFrontendAdapter, registerFrontendAdapters, svelteFrontendAdapter, SVELTE_READING, vueFrontendAdapter, VUE_READING } from './adapter.js';
export { declaresReact, declaresSvelte, declaresVue } from './framework.js';
export { SVELTE_FORMAT, VUE_FORMAT } from './sfc/formats.js';

export { BUILT_IN_PASSES, defaultOutputPath, extractBrowser, extractReact, extractRepo, openProject, REACT_READING } from './extract-repo.js';
export type { BrowserReading, ExtractRepoOptions } from './extract-repo.js';

export { createReactProject, REACT_SOURCE_ROOTS } from './project.js';

export { createReactContext } from './context.js';
export type { CreateContextOptions, ReactExtractContext, ReactStats } from './context.js';

export { buildReactFunctionIndex, ReactFunctionIndex } from './index-functions.js';
export type { BuildFunctionIndexOptions, IndexedFunction, ReactRole } from './index-functions.js';

export { AXIOS, FETCH, OFETCH, REQUEST_CLIENTS } from './clients.js';
export type { CallShape, ClientType, RequestClient } from './clients.js';

export { analyzeApiUrl, ENV_ROOTS, settingKeyOf } from './util/url.js';
export type { ApiUrl, Bindings, ReadAddressOptions } from './util/url.js';
export { requestsOf } from './util/forward.js';
export type { ReadRequest, RequestSite } from './util/forward.js';

export { definePass } from './passes/types.js';
export type { ReactExtractorPass } from './passes/types.js';
export { actionsPass } from './passes/actions.js';
export { callsPass } from './passes/calls.js';
export { entriesPass } from './passes/entries.js';
export { functionsPass } from './passes/functions.js';
export { httpPass } from './passes/http.js';
export { routesPass } from './passes/routes.js';
