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
  REACHED_AS_META,
  RESULT_OF_META,
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
  makeFunctionUrlEntryKey,
  makeApiRouteEntryKey,
  makeInvokeEntryKey,
  makeStateId,
  makeSymbolId,
  makeUnnamedInvokeKey,
  makeUnnamedWorkflowKey,
  makeTypeId,
  makeWorkflowEntryKey,
  normalizeFilePath,
  normalizePath,
  pathKey,
  toPosixPath,
  SITE_LEAF_TYPES,
  UNREAD_SPAN,
  wasRead,
} from './ids.js';
export type { DeployedEntryKind, HttpMethod, ReachedAs, SiteLeafType } from './ids.js';

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
  countsOf,
  DEFAULT_DETAIL,
  DEFAULT_MAX_NODES,
  DETAIL_LEVELS,
  sitesIn,
  tally,
  wasMissed,
  type PlaceCount,
  type RowCounts,
} from './model/graph.js';
export {
  kindOfRow,
  reasonsWithoutKind,
  ROW_KIND_NAMES,
  ROW_KINDS,
  type KindedRow,
  type RowKind,
} from './model/row-kind.js';
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
  customConsumerSchema,
  dbTableAccessSchema,
  httpClientSchema,
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
  builtInShapesFor,
  packageSourcesFor,
  parseConfig,
  shapesFor,
  patternFilesFor,
  serviceConfigSchema,
  serviceNamesOf,
  starterSchema,
} from './config.js';
export type {
  LocalBaseClass,
  CustomBrokerConfig,
  CustomConsumerConfig,
  CustomProducerConfig,
  CustomSubscriberConfig,
  DbTableAccess,
  HttpClientConfig,
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
  PackageSourcesSetting,
  ServiceConfig,
} from './config.js';
export type {
  DefinitionPosition,
  DeployedDefinition,
  DeclaredStream,
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
  CHANNEL_DECLARED_META,
  WHERE_DECLARED_META,
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
export {
  addressOnly,
  hostOf,
  innerServiceName,
  isInnerHost,
  keptValue,
  localHostsOf,
  looksSecret,
  NO_SETTINGS,
  portOf,
} from './setting-files.js';
export type { HostAlias, RepoSettings, ServiceBinding, SettingValue } from './setting-files.js';
export { GUESSED_META, isTaken, RECORDED_META, strongestTaken, TAKEN_BY_META, TAKES_META } from './takes.js';
export type { Takes, Taken, TakenInstead } from './takes.js';
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
  DbFilterAt,
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
  EVERY_KEY,
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
  forgetPackageAliases,
  installedFiles,
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

export {
  declarationShapesOf,
  installDeclarationShapes,
  isDeclarationShape,
  readShapeFile,
  RESOLUTION_ORDER,
  resolutionOrder,
  shapeFileOf,
  shapeFilesOf,
} from './declaration-shapes.js';
export type { DeclarationShape, ResolutionSource, ShapeFileReading } from './declaration-shapes.js';
export { forgetPackageIndexes, packageIndexOf, rangeIncludes, serviceDirOf } from './package-index.js';
export type { PackageIndex, PackageIndexInput, PackageSource, PackageSourceOrigin } from './package-index.js';
export {
  closeStandIns,
  hashShapeFile,
  isWithinDir,
  markStandInEdges,
  mountedFileSystem,
  mountOfPath,
  mountsOf,
  mountTableOf,
  packageCoverage,
  readStandInsOfBuild,
  reportStandIns,
  STAND_INS_FILENAME,
  STAND_INS_FORMAT_VERSION,
  standInFiles,
  standInOfFile,
  standInsFingerprint,
  standInsFingerprintOf,
  standInsFingerprintOfBuild,
  standInsFor,
  standInsOfBuild,
  standInWants,
  realPathOf,
  virtualRootOf,
  withdrawPackageSourceRows,
} from './stand-ins.js';
export { WORK_COUNTS } from './work-counts.js';
export {
  collectPackageUses,
  exportKindOf,
  packageOfImport,
  starterShape,
} from './package-uses.js';
export type { MemberUse, ModuleUses, UsedExport } from './package-uses.js';
export type {
  Mount,
  MountTable,
  PackageAnswer,
  PackageCover,
  PackageIndexRecord,
  StandInContext,
  StandInOfFile,
  StandInRequest,
  StandInsFingerprint,
  StandInsFingerprintInput,
  StandInsForOptions,
  StandInsOfBuild,
  StandInsRead,
} from './stand-ins.js';
export { RXJS_DECLARATION_SHAPE, RXJS_SHAPE } from './rxjs-shape.js';

export { isTestDirectory, isTestFile } from './test-files.js';

export { docsAbove, jsDocCallsIn, jsDocCallsMarkers, namesGivenTo, takesNames, type JsDocCall } from './markers.js';
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
  callsHelper,
  namesHelper,
  CLAIMED_META,
  extendReading,
  FAILURES_META,
  pathParamsOf,
  readRequest,
  REQUEST_PARTS,
  REQUEST_READ_META,
  requestReadingSchema,
  routeOf,
  routeShapeEdge,
  STATUS_UNKNOWN_META,
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
export { classMembersOf } from './di/class-members.js';
export type { ClassMembers } from './di/class-members.js';
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
export { functionLikeOf, recordSignatures, recordStatedSignatures } from './types/signatures.js';
export type { FunctionLike, RecordedSignature, StatedPart, StatedSignature, StatedType } from './types/signatures.js';
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
  argumentAlong,
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
  verbAlong,
  verbParameterOf,
  verbsAtCallers,
  verbSpelledBy,
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
  VerbAtCaller,
  VerbsAtCallers,
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
export { callIndexOf, callShapeOf, callsOnLine, siteNodeAt } from './call-shape.js';
export { BOUNDED_BY, boundedLoopOf, isMigrationFile } from './bounded-loop.js';
export { rankByReach, waysInOf } from './model/row-reach.js';
export type { BoundedBy, BoundedLoop, BoundedLoopOptions, MigrationMarks } from './bounded-loop.js';
export { lineAndColumnAt, startLineOf } from './line-numbers.js';
export type { CallIndex, CallShape, ConcurrentShape, LoopShape } from './call-shape.js';
export {
  ACCEPTED_FILE,
  ACCEPTED_FORMAT_VERSION,
  acceptedFor,
  acceptedKeyOf,
  acceptedPathFor,
  compileAccepted,
  compileRoutePattern,
  covers,
  describeAccepted,
  describeAcceptedProblem,
  gapIdOf,
  isFileGlob,
  isGapId,
  isRule,
  loadAccepted,
  matchesRoutePattern,
  parseGapId,
  readAccepted,
  routeOfSymbol,
  routePatternOf,
  saveAccepted,
  splitAccepted,
  withAccepted,
  withoutAccepted,
} from './accepted.js';
export {
  ACCESS_META,
  ACCESS_WHERE,
  accessOf,
  AUTH_CHECK_WORDS,
  OPT_OUT_WORDS,
  PUBLIC_WORDS,
  soundsLikeAuthCheck,
  soundsLikeOptOut,
  soundsPublic,
} from './access.js';
export type { AccessGuard, AccessOptOut, AccessWhere, RouteAccess } from './access.js';
export type {
  AcceptedFile,
  AcceptedGap,
  AcceptedProblem,
  AcceptedProblemKind,
  AcceptedRead,
  AcceptedRules,
  AcceptedSplit,
  GapLike,
  RoutePattern,
} from './accepted.js';
export {
  AMBIGUOUS_CANDIDATES,
  describeObservedProblem,
  joinIdOf,
  OBSERVED_FILE,
  OBSERVED_FORMAT_VERSION,
  OBSERVED_READ_VERSIONS,
  observedOf,
  observedPathFor,
  readObserved,
} from './observed.js';
export type {
  AmbiguousKind,
  AmbiguousSpan,
  Observed,
  ObservedProblem,
  ObservedProblemKind,
  ObservedRead,
  Seen,
  UnmatchedSpan,
} from './observed.js';
export { compileGlob, expandGlob, isGlob, NEVER_WALKED } from './glob.js';
export type { Glob } from './glob.js';
export {
  compareChoices,
  compareFailures,
  FAILS_META,
  FAILURE_SOURCES,
  failsWithAny,
  failuresOf,
  groupFailures,
  settleFailures,
} from './failures.js';
export type { Failure, FailureChoice, FailureGroup, FailureSource } from './failures.js';
export { hasSiteOrder, loopOfEdge, runsBeside, runsOnFailure, siteOrderOf } from './edge-sites.js';
export {
  askNextOf,
  compareFailChoices,
  groupFails,
  PROMPT_FAIL_SOURCES,
  PROMPT_LIMITS,
  PROMPT_MAX_NEXT,
  PROMPT_WALK,
  promptFit,
  promptHintsFor,
  promptNextFor,
  renderPrompt,
} from './prompt-text.js';
export type {
  PromptAccess,
  PromptCheckPlace,
  PromptCount,
  PromptCrossing,
  PromptFailChoice,
  PromptFailGroup,
  PromptFailure,
  PromptGap,
  PromptLimits,
  PromptLog,
  PromptMarks,
  PromptMember,
  PromptOverview,
  PromptScope,
  PromptStep,
  PromptSubject,
} from './prompt-text.js';

export {
  CAUSE_META,
  CAUSE_SAMPLES,
  CAUSES_META,
  CauseTally,
  PACKAGE_META,
  causeLabel,
  causeMeta,
  causeOfRow,
  causePartsOf,
  groupCantFollow,
  hintForCause,
  isKnownCause,
  knownCauses,
  placeIdOf,
} from './cant-follow.js';
export type {
  CantFollow,
  CantFollowByPackage,
  CantFollowCause,
  CantFollowOptions,
  CantFollowPackage,
  CantFollowRow,
  CantFollowSample,
  CausePart,
  CauseSample,
} from './cant-follow.js';
export {
  causeOfParameterType,
  causeOfTypeNode,
  causeOfUnresolvedType,
  whyNoClass,
  whyUntyped,
} from './follow-cause.js';
export type { FollowCause } from './follow-cause.js';
export { importOf, statedOrigin } from './stated-origin.js';
export type { StatedOrigin } from './stated-origin.js';
export { conditionsHold } from './adapters/conditions.js';
export type { DescriptionCondition } from './adapters/conditions.js';
export { describedRequestsAt, httpVerbOf } from './adapters/http-clients.js';
export type { DescribedEvidence, DescribedRequest } from './adapters/http-clients.js';
export { describedCallKey, withdrawDescribedCalls } from './described-calls.js';
export {
  PATTERN_CAUSES,
  PATTERN_KINDS,
  patternRuleSchema,
  patternsFor,
  readPatternFile,
  readPatternText,
} from './patterns/schema.js';
export type {
  PatternExpectation,
  PatternFileReading,
  PatternKind,
  PatternRule,
  PatternTest,
  RuleReading,
} from './patterns/schema.js';
export { isParsed, parsePattern } from './patterns/parse.js';
export type { ParsedPattern, PatternCall, PatternEntry, PatternNode, PatternSyntaxError } from './patterns/parse.js';
export { compilePattern, describedByOf, isCompiled, opOfName, ruleIdOf } from './patterns/compile.js';
export type { CompiledDescriptor, CompiledRule, CompileResult, HolePlaces, PatternRefusal } from './patterns/compile.js';
export { readPatterns, reportPatterns, withCompiledRules } from './patterns/apply.js';
export type { PatternReading, PlacedRule, RefusedRule } from './patterns/apply.js';
export { precedenceOf, precedenceRows } from './patterns/precedence.js';
export type { Precedence } from './patterns/precedence.js';
export { unmatchedPatternRows } from './patterns/unmatched.js';
export type { ServiceNodes } from './patterns/unmatched.js';
export { matchPatternAt } from './patterns/match.js';
export type { MatchOptions, MatchStep, PatternFit } from './patterns/match.js';
export { guessPatternKind } from './patterns/starter.js';
