/**
 * Technology-agnostic core of flowatlas.
 *
 * Nothing here knows the name of a single framework, ORM, message broker or UI
 * library. Everything specific lives behind the adapter interfaces and reaches
 * the core only through the registry.
 */

export { GraphBuilder } from './builder.js';
export type { GraphBuilderOptions, GraphCounts } from './builder.js';

export {
  AdapterNotFoundError,
  ConfigInvalidError,
  ConfigNotFoundError,
  DanglingEdgeError,
  DuplicateTypeError,
  FlowatlasError,
  InvalidChannelNameError,
  InvalidIdError,
  SchemaVersionMismatchError,
} from './errors.js';

export {
  DATA_REACH,
  HTTP_METHODS,
  holeIn,
  PARAM_PLACEHOLDER,
  isChannelId,
  isEntryId,
  isHttpMethod,
  isTypeId,
  makeChannelId,
  makeConfigKeyId,
  makeEntryId,
  makeExternalApiId,
  makeLeafId,
  makeTableId,
  makeHttpEntryKey,
  makeSymbolId,
  makeTypeId,
  normalizeFilePath,
  normalizePath,
  SITE_LEAF_TYPES,
  UNREAD_SPAN,
  wasRead,
} from './ids.js';
export type { HttpMethod, SiteLeafType } from './ids.js';

export { ENTRY_KINDS, NODE_TYPES, isEntryKind } from './model/nodes.js';
export type { EntryKind, GraphNode, NodeType } from './model/nodes.js';

export { CONFIDENCE_LEVELS, CONFIDENCE_RANK, EDGE_TYPES, strongerConfidence } from './model/edges.js';
export type { Confidence, EdgeType, GraphEdge } from './model/edges.js';

export { TYPE_KINDS } from './model/types.js';
export type { TypeEntry, TypeField, TypeKind, TypeRegistry } from './model/types.js';

export {
  DEFAULT_DETAIL,
  DEFAULT_MAX_NODES,
  DETAIL_LEVELS,
  sitesIn,
  tally,
  wasMissed,
  type PlaceCount,
} from './model/graph.js';
export type {
  DetailLevel,
  ProjectGraph,
  RepoGraph,
  ServiceSummary,
  Unresolved,
  UnresolvedLevel,
} from './model/graph.js';

export { SCHEMA_VERSION } from './schema/version.js';
export {
  assertSchemaVersion,
  graphEdgeSchema,
  graphNodeSchema,
  parseProjectGraph,
  parseRepoGraph,
  projectGraphSchema,
  repoGraphSchema,
  serviceSummarySchema,
  typeEntrySchema,
  typeFieldSchema,
  typeRegistrySchema,
  unresolvedSchema,
} from './schema/zod.js';

export {
  CONFIG_FILENAME,
  DEFAULT_OUTPUT,
  DEFAULT_TYPE_MAX_DEPTH,
  adapterForceSchema,
  customBrokerSchema,
  customProducerSchema,
  customSubscriberSchema,
  entryRegistrySchema,
  findConfig,
  flowatlasConfigSchema,
  loadConfig,
  parseConfig,
  serviceConfigSchema,
} from './config.js';
export type {
  CustomBrokerConfig,
  CustomProducerConfig,
  CustomSubscriberConfig,
  EntryRegistryConfig,
  FlowatlasConfig,
  LoadConfigOptions,
  LoadedConfig,
  ServiceConfig,
} from './config.js';

export {
  LOG_LEVELS,
  allDependencies,
  createLogger,
  hasAnyDependency,
  hasDependency,
  readPackageJson,
  silentLogger,
} from './adapters/context.js';
export type { ExtractContext, LogLevel, Logger, PackageJson } from './adapters/context.js';

export { isFunctionHandler, isInlineHandler } from './adapters/entry.js';
export type {
  EntryAdapter,
  EntryHandler,
  EntryNode,
  FunctionHandler,
  InlineHandler,
  MethodHandler,
} from './adapters/entry.js';
export { classifyDbCall, operationOf } from './adapters/db.js';
export type {
  DataNameHints,
  DbAdapter,
  DbCallInput,
  DbClassification,
  DbDescriptor,
  DbOp,
  DbSource,
  TableOverride,
} from './adapters/db.js';
export {
  declaredParameterType,
  entityNameOf,
  narrowUnionByLiteral,
  originOfType,
  originOfValue,
  packageNameOf,
  packageOfPath,
  resolveTypeOrigin,
  stripWrapperSuffix,
  unwrapDelivery,
  writtenKeysOf,
  writtenObjectLiteral,
} from './origin.js';
export type { BodyRead, Origin, ResolveOriginOptions, TypeOrigin } from './origin.js';
export type { BrokerAdapter, CallPattern, ChannelKind } from './adapters/broker.js';
export type { FrontendAdapter, FrontendExtractOptions } from './adapters/frontend.js';

export { ADAPTER_SLOTS, AdapterRegistry, noAdapters } from './adapters/registry.js';
export type { AdapterForce, AdapterSlot, DetectedAdapters, SlotAdapters } from './adapters/registry.js';

export {
  className,
  externalFilePath,
  fileOf,
  isExternalFile,
  lineOf,
  packageOfFile,
  siteOf,
} from './nodes.js';

export { createProject, findTsconfig, listRepoSources, TSCONFIG_CANDIDATES } from './project.js';
export type { CreateProjectOptions } from './project.js';

export { namesGivenTo, takesNames } from './markers.js';
export type { MarkerNames, RecordedMarker, RefusedArg } from './markers.js';

export { definePass } from './passes.js';
export type { ExtractorPass } from './passes.js';

export { buildClassIndex, ClassIndex } from './class-index.js';
export { functionAt, inlineFunction, memberFunction, moduleFunctions, namedFunction } from './functions.js';
export type { NamedFunction } from './functions.js';
export type { BuildClassIndexOptions, IndexedClass } from './class-index.js';

export {
  declarationOf,
  evaluateExpression,
  literalUnionOf,
  resolvedValue,
  stableKey,
  unresolvedValue,
} from './static-value.js';
export type { StaticValue } from './static-value.js';

export { resolveStaticString, settingKeyIn } from './static-string.js';
export type {
  SettingBehind,
  StaticString,
  StaticStringOptions,
  StaticStringVia,
} from './static-string.js';

export {
  decoratorArgs,
  decoratorExportedName,
  decoratorModule,
  decoratorName,
  findDecorators,
  firstStringArg,
  getDecorator,
  hasDecorator,
  stringListArg,
} from './decorators.js';
export type { DecoratorMatch } from './decorators.js';

export { resolveConstructorInjection, resolveFieldInjection } from './di/constructor.js';
export { resolveClassOfExpression, resolveClassOfType } from './di/class-ref.js';
export type { ClassRef } from './di/class-ref.js';
export {
  bodyOf,
  enclosingMethod,
  findMethod,
  forEachCall,
  methodBodies,
  methodNamedOn,
  methodsOfClass,
  parametersOf,
  resolveReceiver,
} from './di/member-call.js';
export type { ClassMethod, ReceiverInfo } from './di/member-call.js';
export { DiMap } from './di/types.js';
export type {
  DiEntry,
  DiResolution,
  DiResolverOptions,
  DiTarget,
  DiUnresolved,
  DiVia,
  TokenProviderKind,
} from './di/types.js';

export { isLibFile, TypeCollector } from './types/collector.js';
export type { TypeCollectorOptions } from './types/collector.js';
export { mergeFieldMeta } from './types/field-meta.js';
export type { FieldDeclaration, FieldMetaReader, FieldMetaResult } from './types/field-meta.js';
export { DEFAULT_HASH_DEPTH, normalizeStructure, structuralHash } from './types/structural-hash.js';
export type { StructuralHashOptions } from './types/structural-hash.js';
export {
  PRIMITIVES,
  TypeRefParseError,
  formatTypeRef,
  idsOfTypeRef,
  isPrimitiveName,
  parseTypeRef,
} from './types/type-ref.js';
export type { PrimitiveName, TypeRef, TypeRefAst, TypeRefField } from './types/type-ref.js';

export {
  addressAt,
  callSitesOf,
  choosesASegment,
  constantMethodResult,
  constantPropertyValue,
  deref,
  finiteLookups,
  MOST_CHOICES,
  foldedChoices,
  literalChoices,
  forwardedFrom,
  isQueryTail,
  isReadable,
  parameterBehind,
  readsParameterOf,
  remembersParametersOf,
  returnedExpression,
  rootSettingAddress,
  rootSettingKey,
  splitAtParameter,
  writtenBodyOutward,
} from './trace.js';
export type {
  CallFrame,
  FiniteLookup,
  ForwardedCall,
  RootSettingOptions,
  SettingAddress,
  SplitAddress,
} from './trace.js';
