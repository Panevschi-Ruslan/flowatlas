/**
 * Extractor for repositories built on the Angular framework.
 *
 * Everything framework-specific lives here: which decorators name a component,
 * how a template spells a trigger, which client makes a request. The core knows
 * none of it and reaches this package only through the adapter registry.
 */

export { angularFrontendAdapter, registerFrontendAdapters } from './adapter.js';

export { BUILT_IN_PASSES, defaultOutputPath, extractAngular, extractRepo } from './extract-repo.js';
export type { ExtractRepoOptions } from './extract-repo.js';

export { createAngularContext } from './context.js';
export type {
  AngularExtractContext,
  AngularStats,
  CreateContextOptions,
  ModuleMembership,
  RouteEntry,
} from './context.js';

export {
  ANGULAR_CORE,
  ANGULAR_HTTP,
  buildAngularClassIndex,
  componentDecorator,
  injectableDecorator,
  moduleDecorator,
} from './index-classes.js';
export type { AngularClassIndex, AngularRole, IndexedClass } from './index-classes.js';

export { angularDiOptions } from './di.js';

export { parseAngularTemplate } from './template.js';
export type {
  ParseTemplateOptions,
  TemplateEvent,
  TemplateEventKind,
  TemplateHandler,
} from './template.js';

export { collectRoutes } from './routes.js';
export { analyzeApiUrl, ENV_ROOTS } from './util/url.js';
export type { ApiUrl } from './util/url.js';
export { arrayProperty, booleanProperty, metadataOf, propertyOf, stringProperty } from './util/metadata.js';

export { definePass } from './passes/types.js';
export type { AngularExtractorPass } from './passes/types.js';
export { callsPass } from './passes/calls.js';
export { classesPass } from './passes/classes.js';
export { httpPass } from './passes/http.js';
export { markersPass } from './passes/markers.js';
export { modulesPass } from './passes/modules.js';
export { ssePass } from './passes/sse.js';
export { templatesPass } from './passes/templates.js';
