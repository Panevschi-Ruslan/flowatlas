/**
 * Joining the repositories into one graph.
 *
 * Two things cross a service boundary: a call to another service's route, and a
 * message on a channel. Both are joined here, which is the step everything
 * earlier has been building toward.
 */
export { configHashOf, linkGraphs } from './link.js';
export type { LinkOptions, LinkResult } from './link.js';
export { mergeGraphs } from './merge.js';
export type { Merged, TypeVersion } from './merge.js';
export { findingFor, resolveCall } from './http-link.js';
export type {
  CallOutcome,
  CallsServiceMarker,
  Finding,
  OutcomeKind,
  Resolution,
  RouteIndex,
} from './http-link.js';
export { resolveUiCall, uiFindingFor, uiReasonOf } from './ui-link.js';
export { hostIndexOf } from './base-url-value.js';
export type { UiIndex, UiOutcome, UiOutcomeKind, UiVia } from './ui-link.js';
export {
  DECLARED_BY,
  DOCUMENT_KINDS,
  DOCUMENT_READERS,
  DocumentError,
  documentReader,
} from './document/index.js';
export type {
  DocumentReader,
  JsonSchemaNode,
  ReadDocumentOptions,
  ReadDocumentResult,
} from './document/index.js';
export { readOpenapiDocument } from './openapi/index.js';
export { readAsyncapiDocument } from './asyncapi/index.js';
export { OPENAPI_VERSION, proceduresOf, writeOpenapiDocument, writeOpenapiDocuments } from './openapi/write.js';
export { ASYNCAPI_VERSION, writeAsyncapiDocument } from './asyncapi/write.js';
export {
  DEFAULT_SPEC_DEPTH,
  SCHEMA_REF_PREFIX,
  shapeWriter,
  SPEC_UNREAD_REASONS,
  TYPE_KEY,
  typeToJsonSchema,
  UNREAD_KEY,
  unreadCounts,
  unreadSchema,
} from './document/write-shapes.js';
export type { JsonSchema, ShapeOptions, ShapeRoot, ShapeSource, ShapeWriter, SpecUnreadReason } from './document/write-shapes.js';
export {
  applicationOf,
  publicOf,
  routeCallers,
  SPEC_KINDS,
  SPEC_OMITTED_REASONS,
  SPEC_VERSION_SAID,
  specOptionsOf,
} from './document/written.js';
export { SPEC_WANTED, writeSpecs } from './document/specs.js';
export type { SpecWanted } from './document/specs.js';
export type { SpecCaller, SpecKind, SpecOmittedReason, SpecOperation, SpecOptions, WrittenSpec } from './document/written.js';
export { verifyWritten } from './document/verify.js';
export { findOperations, specFragment } from './document/fragment.js';
export { routeInventory } from './document/inventory.js';
export type { InventoryRow } from './document/inventory.js';
export * from './spec-diff/index.js';
export { surveyChannels, surveyRoutes } from './survey.js';
export type { ChannelSurvey, RouteSurvey } from './survey.js';
export { matchesRoutePattern } from './route-audit.js';
export { answeringAt, couldReach, isMatch, matchRoute, oneSegmentOff, pathAnswers } from './route-match.js';
export type { RouteMatch, RouteMiss, RouteResult } from './route-match.js';
export { missedOf } from './report.js';
export {
  channelToken,
  MISSING_KINDS,
  missingByGap,
  missingGroupsOf,
  missingKeyOf,
  missingRepoSignals,
  missingTokenOfGap,
  rankMissing,
  sayEvidence,
  saySeen,
  saySignal,
  servicesOfReport,
  servicesOfSignal,
  STRONG_KINDS,
  worthSaying,
} from './missing-repo.js';
export type {
  MissingGroup,
  MissingKind,
  MissingPlace,
  MissingSeen,
  MissingRepoProject,
  MissingRepoReader,
  MissingRow,
  MissingService,
  MissingSignal,
} from './missing-repo.js';
export type { LinkReport, LinkTotals, ServicePackages, ServiceReport } from './report.js';
export { replaceService, writeGraphDb } from './db/writer.js';
export type { WriteOptions } from './db/writer.js';
export { blastRadius, BLAST_EDGES, DEFAULT_BLAST_DEPTH, PROVIDER_EDGES } from './diff/blast-radius.js';
export { compareDeclarations } from './diff/compare-declarations.js';
export type { DeclarationCompareOptions } from './diff/compare-declarations.js';
export { diffGraphs, impactedNodes } from './diff/diff-graphs.js';
export { edgeFingerprint, nodeFingerprint, stableJson } from './diff/fingerprint.js';
export { CHECK_FORMAT_VERSION, CHECK_REASON_KINDS, CHECK_REFUSALS, CHECK_VERDICTS, DIFF_WARNINGS } from './diff/report.js';
export type {
  CheckMove,
  CheckPin,
  CheckPlace,
  CheckReason,
  CheckReasonKind,
  CheckRefusal,
  CheckRefusalReason,
  CheckReport,
  CheckVerdict,
  CheckVerdictWord,
  DiffContracts,
  DiffReport,
  DiffRules,
  DiffSide,
  DiffSource,
  DiffTiming,
  DiffWarning,
  DiffWarningReason,
} from './diff/report.js';
export {
  checkReportSchema,
  graphDiffSchema,
  graphDiffSchemaV1,
  graphDiffSchemaV2,
  graphDiffSchemaV3,
  graphDiffSchemaV4,
  isCheckDocument,
  parseCheckReport,
  parseGraphDiff,
} from './diff/schema.js';
export {
  DEFAULT_RULE_WALK,
  evaluateRules,
  RULE_FAIL_LEVELS,
  ruleFailures,
  ruleGapOf,
  ruleKeyOf,
  saySelector,
  stableNodeKey,
} from './rules/evaluate.js';
export type { EvaluateOptions, RuleFailLevel } from './rules/evaluate.js';
export { partialServicesOf, ruleGraphOf } from './rules/graph.js';
export { parseRulesReport, ruleHopSchema, rulesReportSchema, ruleUncheckedSchema, ruleViolationSchema } from './rules/schema.js';
export { RULE_REASONS, RULE_STATUSES, RULES_FILE, RULES_FORMAT_VERSION } from './rules/types.js';
export type {
  RuleGraph,
  RuleHop,
  RuleNote,
  RulePlace,
  RuleResult,
  RulesReport,
  RuleStatus,
  RulesSummary,
  RuleUnchecked,
  RuleViolation,
} from './rules/types.js';
export {
  countSteps,
  diffSequences,
  FLOW_SIDES,
  flowChanged,
  flowChangeOf,
  onlyOn,
  PARTICIPANT_KINDS,
  sayCounts,
  sayStep,
  SEQUENCE_DETAILS,
  sequenceOf,
  servicesCrossed,
  siteOfEdge,
  STATUS_MARK,
  STEP_KINDS,
  STEP_STATUSES,
  stepKeyOf,
  typeNotesOf,
} from './diff/sequence.js';
export type {
  DiffSequenceOptions,
  FlowChange,
  FlowSide,
  Participant,
  ParticipantKind,
  Sequence,
  SequenceChange,
  SequenceDetail,
  SequenceOptions,
  SequenceSite,
  SequenceStep,
  SequenceTree,
  StepGroup,
  StepKind,
  StepStatus,
  WalkedSide,
} from './diff/sequence.js';
export {
  DIFF_FORMAT_VERSION,
  DIFF_SECTIONS,
  GAP_REF_KINDS,
  LOST_JOIN_KINDS,
  TYPE_FIELD_CHANGES,
  edgeKeyOf,
  sectionsMissing,
} from './diff/types.js';
export { diffUnresolved, gapRefsOf } from './diff/gap-refs.js';
export type { GapGraph } from './diff/gap-refs.js';
export { lostJoins, NEVER_PRODUCED, NO_EDGE, REQUEST_JOIN_EDGES } from './diff/lost-joins.js';
export type { JoinGraph } from './diff/lost-joins.js';
export type {
  BlastEntry,
  BlastOptions,
  BlastRadius,
  BlastRow,
  DiffOptions,
  EdgeChange,
  EdgeDiff,
  EdgeRef,
  GapRef,
  GapRefKind,
  GraphCounts,
  GraphDiff,
  JoinDiff,
  LostJoin,
  LostJoinKind,
  NodeChange,
  NodeDiff,
  TypeChange,
  TypeDiff,
  TypeFieldChange,
  TypeFieldChangeKind,
  UnresolvedCount,
  UnresolvedDiff,
} from './diff/types.js';
export { GraphDb, GraphStore, openGraphDb } from './db/reader.js';
export { acceptedSplitOf } from './db/accepted-split.js';
export type { AcceptedSplitOf, SplitRow } from './db/accepted-split.js';
export {
  ANSWERED_HINT,
  answeredByMarker,
  callerOfProducer,
  canonicalReason,
  coversEveryUnread,
  MARKER_ANSWERS,
  requestsAround,
  withAnsweredDemoted,
} from './answered.js';
export type { DemotableRow, MarkerGraph } from './answered.js';
export type {
  AnchoredUnresolvedRow,
  SearchOptions,
  TraverseOptions,
  TraverseResult,
  TraverseRow,
  UnresolvedRow,
} from './db/reader.js';
export {
  classifyRoute,
  DEAD_VERDICTS,
  deadChannels,
  deadEntries,
  deadMethods,
  deadProviders,
  deadVerdict,
  ENTRY_CLASS_NAMES,
  EXTERNALLY_TRIGGERED,
  routeFactsOf,
  unresolvedInjectCount,
  VERDICT_ORDER,
} from './analysis/dead.js';
export type {
  DeadAnswer,
  DeadChannel,
  DeadConfidence,
  DeadEntry,
  DeadEvidence,
  DeadMethod,
  DeadOptions,
  DeadProvider,
  DeadVerdict,
  EntryClassName,
  InfrastructureRole,
  InfrastructureRules,
  NearMiss,
  OneOff,
  RouteClass,
  RouteFacts,
} from './analysis/dead.js';
export { methodsByOwner, methodsOf, ownerOf, weakest } from './analysis/graph.js';
export {
  bestGuessCounts,
  confirmedByTraffic,
  confirmedJoins,
  MIN_NEIGHBOUR_HITS,
  neverSeen,
  trafficOverlay,
} from './analysis/never-seen.js';
export type {
  NeverSeenAnswer,
  NeverSeenConfidence,
  NeverSeenOptions,
  NeverSeenRow,
  ObservedInput,
  TrafficOverlay,
} from './analysis/never-seen.js';
export { collectFindings, compareFindingKinds, FINDING_KINDS, findingKindOf, rankFindings } from './analysis/findings.js';
export type {
  CollectedFindings,
  ContractBreak,
  FindingKindName,
  FindingReach,
  FindingRow,
  FindingSources,
} from './analysis/findings.js';
export {
  blockRegion,
  closingMarker,
  DEFAULT_DOC_VIEW,
  DOC_KINDS,
  DOC_STATES,
  DOC_VIEWS,
  DOCS_FILE,
  DOCS_FORMAT_VERSION,
  docsEntrySchema,
  docsIndexSchema,
  encodeAttribute,
  FINGERPRINT_LENGTH,
  fingerprintRows,
  flowFingerprint,
  NOTE_SLOT,
  ORPHANED_HEADING,
  parseDocBlocks,
  parseDocs,
  positionFreeId,
  readDocsIndex,
  readRecordedStep,
  recordStep,
  renderTour,
  rewriteDocBlocks,
  STEPS_END,
  tourNotesOf,
} from './docs/index.js';
export type {
  DocBlock,
  DocKind,
  DocOptions,
  DocProblem,
  DocRewrite,
  DocsEntry,
  DocsIndex,
  DocState,
  DocView,
  FingerprintTree,
  ParsedDocs,
  RecordedStep,
  TourNote,
  TourStep,
} from './docs/index.js';
export {
  collapseLabels,
  drawnByDefault,
  EXPORT_CONFIDENCES,
  exportModelOf,
  JOIN_KINDS,
  publishersOf,
  SERVICE_KINDS,
  serviceKindOf,
} from './export/joins.js';
export type {
  ExportApi,
  ExportGraph,
  ExportJoin,
  ExportModel,
  ExportModelOptions,
  ExportService,
  JoinEdge,
  JoinKind,
  JoinTarget,
  ServiceHalf,
  ServiceKind,
} from './export/joins.js';
export {
  BACKSTAGE_ANNOTATIONS,
  BACKSTAGE_API_VERSION,
  BACKSTAGE_LOCATION_FILE,
  BACKSTAGE_RESOURCES_FILE,
  CATALOG_UNKNOWN,
  exportBackstage,
} from './export/backstage.js';
export type { BackstageDocument, BackstageEntity, BackstageExport, BackstageOptions, BackstageSummary, ExportFile } from './export/backstage.js';
export {
  channelGroupOf,
  DEFAULT_EXPORT_FLOWS,
  DEFAULT_MAX_LABELS,
  dslString,
  exportStructurizr,
  renderWorkspace,
  STRUCTURIZR_FILE,
} from './export/structurizr.js';
export type {
  ExportFlow,
  StructurizrElement,
  StructurizrExport,
  StructurizrModel,
  StructurizrOptions,
  StructurizrRelationship,
  StructurizrStep,
  StructurizrSummary,
  StructurizrView,
} from './export/structurizr.js';
export { catalogName, dslIdentifier, MAX_CATALOG_NAME, nameBook } from './export/names.js';
export { yamlDocument, yamlDocuments, yamlScalar } from './export/yaml.js';
export type { YamlValue } from './export/yaml.js';
export { catalogEntityProblems, catalogProblems, dslProblems } from './export/checks.js';
