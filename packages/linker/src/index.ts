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
export type { UiIndex, UiOutcome, UiOutcomeKind, UiVia } from './ui-link.js';
export { surveyChannels, surveyRoutes } from './survey.js';
export type { ChannelSurvey, RouteSurvey } from './survey.js';
export { matchesRoutePattern } from './route-audit.js';
export { isMatch, matchRoute, pathAnswers } from './route-match.js';
export type { RouteMatch, RouteMiss, RouteResult } from './route-match.js';
export type { LinkReport, ServiceReport } from './report.js';
export { replaceService, writeGraphDb } from './db/writer.js';
export type { WriteOptions } from './db/writer.js';
export { blastRadius, BLAST_EDGES, PROVIDER_EDGES } from './diff/blast-radius.js';
export { compareDeclarations } from './diff/compare-declarations.js';
export type { DeclarationCompareOptions } from './diff/compare-declarations.js';
export { diffGraphs, impactedNodes } from './diff/diff-graphs.js';
export { edgeFingerprint, nodeFingerprint, stableJson } from './diff/fingerprint.js';
export { DIFF_WARNINGS } from './diff/report.js';
export type {
  DiffContracts,
  DiffReport,
  DiffSide,
  DiffSource,
  DiffTiming,
  DiffWarning,
  DiffWarningReason,
} from './diff/report.js';
export { graphDiffSchema, parseGraphDiff } from './diff/schema.js';
export { DIFF_FORMAT_VERSION, TYPE_FIELD_CHANGES, edgeKeyOf } from './diff/types.js';
export type {
  BlastEntry,
  BlastOptions,
  BlastRadius,
  BlastRow,
  DiffOptions,
  EdgeChange,
  EdgeDiff,
  EdgeRef,
  GraphCounts,
  GraphDiff,
  NodeChange,
  NodeDiff,
  TypeChange,
  TypeDiff,
  TypeFieldChange,
  TypeFieldChangeKind,
  UnresolvedCount,
} from './diff/types.js';
export { GraphDb, GraphStore, openGraphDb } from './db/reader.js';
export type {
  SearchOptions,
  TraverseOptions,
  TraverseResult,
  TraverseRow,
  UnresolvedRow,
} from './db/reader.js';
