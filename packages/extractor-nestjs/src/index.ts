/**
 * Extractor for repositories built on the NestJS framework.
 *
 * Everything framework-specific lives here and in the adapter packages; the core
 * knows none of it. What used to live here and turned out to be about TypeScript
 * rather than about Nest — reading decorators and constants, resolving injection
 * and call receivers, indexing classes, loading a project — now lives in
 * `@flowatlas/core` and is re-exported below, so that a package built on this one
 * keeps the imports it had.
 */

export {
  extractRepo,
  createRepoProject,
  BUILT_IN_PASSES,
  defaultOutputPath,
} from './extract-repo.js';
export type { ExtractRepoOptions } from './extract-repo.js';

export {
  dependentsOf,
  extractRepoFull,
  extractRepoIncremental,
  globalFiles,
  importsOf,
  openRepo,
  reopenRepo,
  repoFiles,
} from './incremental.js';
export type { ScopedExtract, WarmRepo } from './incremental.js';

export { createProject, findTsconfig, listRepoSources, TSCONFIG_CANDIDATES } from '@flowatlas/core';
export type { CreateProjectOptions } from '@flowatlas/core';

export { createNestContext } from './context.js';
export type { NestExtractContext, NestStats, CreateContextOptions } from './context.js';

export { repoSourceFiles, scopesOf, WALKED_ROLES } from './scopes.js';
export type { Holder, Scope } from './scopes.js';

export { buildClassIndex, ClassIndex, NEST_COMMON } from './index-classes.js';
export type {
  BuildClassIndexOptions,
  ClassRole,
  IndexedClass,
  NestClassIndex,
} from './index-classes.js';

export { ModuleIndex } from './modules-index.js';
export type { ModuleInfo, ModuleKind, ProviderRegistration } from './modules-index.js';

export { DiMap } from '@flowatlas/core';
export type {
  DiEntry,
  DiResolution,
  DiResolverOptions,
  DiTarget,
  DiUnresolved,
  TokenProviderKind,
} from '@flowatlas/core';
export { nestDiOptions, resolveInjectToken } from './di/resolver.js';

export {
  enclosingMethod,
  findMethod,
  forEachCall,
  methodBodies,
  parametersOf,
  resolveReceiver,
} from '@flowatlas/core';
export type { ReceiverInfo } from '@flowatlas/core';

export {
  decoratorArgs,
  decoratorModule,
  decoratorName,
  evaluateExpression,
  findDecorators,
  firstStringArg,
  decoratorExportedName,
  getDecorator,
  hasDecorator,
  resolvedValue,
  stableKey,
  stringListArg,
  unresolvedValue,
} from '@flowatlas/core';
export type { DecoratorMatch, StaticValue } from '@flowatlas/core';

export {
  className,
  externalFilePath,
  fileOf,
  isExternalFile,
  lineOf,
  packageOfFile,
} from '@flowatlas/core';

export {
  isDynamicModuleExpression,
  resolveCallableRef,
  resolveClassExpression,
  unwrapClassExpression,
} from './util/resolve-class.js';
export { resolveClassOfType } from '@flowatlas/core';
export type { ClassRef } from '@flowatlas/core';

export { MARKER_MODULES, MARKER_NAMES, otherDecorators, readMarkers } from './util/markers.js';
export type { RecordedMarker } from './util/markers.js';

export {
  BOOTSTRAP_CANDIDATES,
  findBootstrapFile,
  readBootstrap,
  WRAPPING_LAYERS,
} from './bootstrap.js';
export type { BootstrapGlobal, BootstrapInfo, WrapperRef, WrappingLayer } from './bootstrap.js';

export { collectWrapping } from './wrapping/collect.js';
export { emptyCollection } from './wrapping/types.js';
export type {
  EntryRecord,
  MiddlewareRoute,
  MiddlewareRoutes,
  WrapperApplication,
  WrappingCollection,
  WrappingScope,
} from './wrapping/types.js';

export { definePass } from './passes/types.js';
export type { NestExtractorPass } from './passes/types.js';
export { modulesPass } from './passes/modules.js';
export { providersPass } from './passes/providers.js';
export { entriesPass } from './passes/entries.js';
export { diPass } from './passes/di.js';
export { callsPass } from './passes/calls.js';
export { pathMatches, routeMatches, wrappingCollectPass, wrappingEdgesPass } from './passes/wrapping.js';

export { typesPass } from './passes/types-pass.js';
export { createNestFieldMetaReader, nestFieldMetaReader } from './types/field-meta-reader.js';
export type { NestFieldMetaOptions } from './types/field-meta-reader.js';
