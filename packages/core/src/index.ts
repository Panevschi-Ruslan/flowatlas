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
  REACHES_META,
  STARTS_META,
  STEP_OF_META,
  STEPS_META,
  isChannelId,
  isDeployedEntryKind,
  makeDeployedReference,
  isEntryId,
  isHttpMethod,
  isTypeId,
  makeChannelId,
  makeConfigKeyId,
  entryReferenceOf,
  makeEntryId,
  makeEntryReference,
  makeExternalApiId,
  makeLeafId,
  makeTableId,
  makeHttpEntryKey,
  makeInvokeEntryKey,
  makeStateId,
  makeSymbolId,
  makeUnnamedInvokeKey,
  makeUnnamedWorkflowKey,
  makeTypeId,
  makeWorkflowEntryKey,
  normalizeFilePath,
  normalizePath,
  SITE_LEAF_TYPES,
  UNREAD_SPAN,
  wasRead,
} from './ids.js';
export type { DeployedEntryKind, HttpMethod, SiteLeafType } from './ids.js';

export { ENTRY_KINDS, NODE_TYPES, isEntryKind } from './model/nodes.js';
export { SENDS_META, wayInBodyRead } from './model/way-in.js';
export type { EntryKind, GraphNode, NodeType } from './model/nodes.js';

export {
  CONFIDENCE_LEVELS,
  CONFIDENCE_RANK,
  DECLARED_CONFIDENCE,
  EDGE_TYPES,
  strongerConfidence,
} from './model/edges.js';
export type { Confidence, EdgeType, GraphEdge } from './model/edges.js';

export { SIGNATURE_META, TYPE_KINDS } from './model/types.js';
export type {
  Signature,
  SignatureParam,
  TypeEntry,
  TypeField,
  TypeKind,
  TypeRegistry,
} from './model/types.js';

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
  localBaseClassNames,
  localBaseTableProperty,
  customBrokerSchema,
  customProducerSchema,
  customSubscriberSchema,
  entryHttpAppTypesSchema,
  entryHttpMiddlewareSchema,
  entryHttpMountSchema,
  entryHttpRouteObjectSchema,
  entryHttpSchema,
  entryProcedureMountSchema,
  entryProcedureSchema,
  entryRegistrySchema,
  findConfig,
  flowatlasConfigSchema,
  infraModuleSchema,
  loadConfig,
  parseConfig,
  serviceConfigSchema,
  starterSchema,
} from './config.js';
export type {
  LocalBaseClass,
  CustomBrokerConfig,
  CustomConsumerConfig,
  CustomProducerConfig,
  CustomSubscriberConfig,
  EntryHttpConfig,
  EntryHttpDescription,
  EntryProcedureConfig,
  EntryProcedureDescription,
  EntryRegistryConfig,
  FlowatlasConfig,
  InfraModuleConfig,
  InfraModuleDescription,
  LoadConfigOptions,
  StarterConfig,
  LoadedConfig,
  ServiceConfig,
} from './config.js';
export type {
  DefinitionPosition,
  DeployedDefinition,
  DeployedDelivery,
  DeployedFunction,
  DeployedHandler,
  DeployedKind,
  DeployedRoute,
  DeployedWorkflow,
  DeployedSetting,
  DeliveryKind,
  DeliverySource,
  DeliveryTarget,
  Deployment,
  DeploymentReader,
  DeploymentReadOptions,
  MessagePattern,
  MessageTarget,
  PublishedRoot,
  RouteTarget,
  ValueFilter,
} from './adapters/deployment.js';
export {
  ADDRESS_SEPARATOR,
  AWAITING_META,
  CHANNEL_FORWARD_META,
  CHANNEL_PATTERN_META,
  ENVIRONMENT_META,
  forwardedName,
  matchChannelPattern,
  nameInForms,
  nameWithin,
} from './channel-pattern.js';
export type {
  AwaitedAddress,
  AwaitedPart,
  ChannelForward,
  ChannelPattern,
  EnvironmentValue,
  PatternMatch,
} from './channel-pattern.js';
export { OPERATION_VERBS, operationsOf } from './declared-operations.js';
export type { DeclaredOperation } from './declared-operations.js';
export {
  documentOf,
  DocumentSyntaxError,
  fromValue,
  readDocument,
  readJson,
  readYaml,
  shifted,
} from './positioned-document.js';
export type { DefinitionFormat, PathStep, PositionedDocument } from './positioned-document.js';

export {
  applicationOfFile,
  applicationsIn,
  applicationsServing,
  recordApplications,
  ROOT_APPLICATION,
} from './adapters/applications.js';
export type { ApplicationKeys, ApplicationMap } from './adapters/applications.js';
export { LOG_LEVELS, createLogger, silentLogger } from './adapters/context.js';
export type { ExtractContext, LogLevel, Logger } from './adapters/context.js';
export {
  allDependencies,
  hasAnyDependency,
  hasDependency,
  manifestsWithin,
  packageOfSpecifier,
  readPackageJson,
  readResolvedPackageJson,
  suppliedWith,
} from './adapters/manifest.js';
export type { PackageJson } from './adapters/manifest.js';

export { addEntryWrapping, addWrappingEdges, WRAPPING_LAYERS, WRAPPING_SCOPES } from './adapters/wrapping.js';
export type {
  AppliedWrapping,
  EntryWrapping,
  WrappingLayer,
  WrappingScope,
} from './adapters/wrapping.js';

export { isFunctionHandler, isInlineHandler } from './adapters/entry.js';
export type {
  EntryAdapter,
  EntryHandler,
  EntryNode,
  FunctionHandler,
  InlineHandler,
  MethodHandler,
} from './adapters/entry.js';
export { classifyDbCall, isUniversalMethod, operationOf } from './adapters/db.js';
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
  boundDeclaration,
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
export type { AddressPart, BrokerAdapter, CallPattern, ChannelKind, StartedEntry } from './adapters/broker.js';
export {
  EVERY_ELEMENT,
  locatedExpressions,
  locatedSlots,
  locatorApplies,
  locatorIsCondition,
  originsOf,
} from './adapters/locator.js';
export type {
  IsOperation,
  LocatedSlot,
  LocatorContext,
  LocatorSite,
  NameLocator,
  ValueOrigin,
} from './adapters/locator.js';
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

export {
  DECLARED_IN,
  DECLARED_LINE,
  declaredAt,
  exportSiteIn,
  reachHere,
  reachMeta,
  reachOf,
  reachedAt,
  sameLocation,
} from './location.js';
export type { Location, Reach } from './location.js';

export {
  isServiceSource,
  serviceExtent,
  serviceSourceDirs,
  workspaceGlobs,
  workspacePackages,
  workspaceRootOf,
} from './workspace.js';
export type { ExtentPackage, WorkspacePackage } from './workspace.js';

export {
  countSources,
  createProject,
  findTsconfig,
  listRepoSources,
  reportSkippedTestDirectories,
  reportUnreadableSources,
  SKIPPED_TEST_DIRECTORY_REASON,
  skippedTestDirectories,
  sourceRootsOf,
  TSCONFIG_CANDIDATES,
  UNREADABLE_FILE_REASON,
} from './project.js';
export type {
  CreateProjectOptions,
  RepoStats,
  SourceCounts,
  SourceRootOptions,
  UnreadableSourceContext,
} from './project.js';

export { isTestDirectory, isTestFile } from './test-files.js';

export { namesGivenTo, takesNames } from './markers.js';
export type { MarkerNames, RecordedMarker, RefusedArg } from './markers.js';

export { definePass } from './passes.js';
export type { ExtractorPass } from './passes.js';

export { buildClassIndex, ClassIndex } from './class-index.js';
export {
  functionAt,
  inlineFunction,
  memberFunction,
  moduleFunctions,
  namedFunction,
  placedFunction,
  placeOf,
} from './functions.js';
export {
  CARRIES_ON_META,
  ELEMENT,
  ENVELOPE_META,
  envelopePath,
  messageTypeAt,
  READS_META,
} from './envelope.js';
export type { Envelope } from './envelope.js';
export {
  CLAIMED_META,
  FAILURES_META,
  readRequest,
  REQUEST_PARTS,
  REQUEST_READ_META,
  requestReadingSchema,
  routeShapeEdge,
} from './request.js';
export type { FoundType, RequestPart, RequestReading, RequestReadingDescription, RouteShape } from './request.js';
export { suppliedTypes } from './supplied.js';
export type { SuppliedTypes } from './supplied.js';
export type { NamedFunction } from './functions.js';
export type { BuildClassIndexOptions, IndexedClass } from './class-index.js';

export {
  declarationOf,
  evaluateExpression,
  isRunTimeValue,
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
export { functionLikeOf, recordSignatures } from './types/signatures.js';
export type { FunctionLike, RecordedSignature } from './types/signatures.js';
export { mergeFieldMeta } from './types/field-meta.js';
export type { FieldDeclaration, FieldMetaReader, FieldMetaResult, UnreadAnnotation } from './types/field-meta.js';
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
  dispatchOf,
  finiteLookups,
  MOST_CHOICES,
  foldedChoices,
  literalChoices,
  forwardedFrom,
  forwardNoWorse,
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
  Dispatch,
  FiniteLookup,
  Forwarded,
  ForwardedCall,
  Forwarder,
  Forwarding,
  ForwardReader,
  RootSettingOptions,
  SettingAddress,
  SplitAddress,
} from './trace.js';

export {
  isPlatformProvided,
  isPlatformRequest,
  PLATFORM_FETCH,
  requestBodyOf,
  requestVerbOf,
} from './platform-fetch.js';
export type { OptionsRequestShape } from './platform-fetch.js';
export { SERVICES_DIRECTORY, serviceDirectoryName, serviceOutputDir } from './service-output.js';
