/**
 * The map, offered to an agent.
 *
 * Everything before this built a graph nobody read. These tools are how a
 * session in one repository answers a question about another one without
 * opening it.
 */
export { createFlowatlasServer, startStdioServer, SERVER_NAME, INSTRUCTIONS } from './server.js';
export type { ServerOptions } from './server.js';
export { canAnswer, isToolName, NEEDS, TOOL_NAMES, TOOL_NEEDS } from './tool-needs.js';
export type { Need, NeedSource, ToolFacts, ToolName } from './tool-needs.js';
export { LISTING_POLL_MS, listingSettingsOf, ToolListing } from './tool-listing.js';
export type { ListingOptions, ListingSettings } from './tool-listing.js';
export { DbHandle } from './query/db.js';
export { ruleBreaksAt, rulesReportOf, violatedHops } from './tools/rules.js';
export type { DbHandleOptions, SourceRoots } from './query/db.js';
export { resolveEntryRef, resolveSymbol, isResolved } from './query/entry-ref.js';
export type { EntryRef, Resolved } from './query/entry-ref.js';
export {
  buildFlowTree,
  DEFAULT_FLOW_DEPTH,
  defaultFlowDepth,
  walkBack,
  flatten,
  FORWARD_EDGES,
  REVERSE_EDGES,
  CROSSING_EDGES,
  PLUMBING_FAN_IN,
  MAX_CROSSINGS_LEFT,
  DEFAULT_WALK_NODES,
} from './query/flow.js';
export type { CrossingLeft, FlowOptions, FlowResult } from './query/flow.js';
export { projectDetail, projectEdge, truncate, clampDetail, CLAMP_NOTE, MAX_DETAIL } from './query/detail.js';
export type { Truncated } from './query/detail.js';
export { truncationMessage } from './query/types.js';
export type {
  CommonInput,
  CompactNode,
  FlowEdge,
  FlowNode,
  GuardRef,
  ToolResult,
  Truncation,
  Cut,
  WalkLimit,
} from './query/types.js';
export type {
  ContractChecker,
  ContractFinding,
  PatternTester,
  PatternTesterAnswer,
  PatternTesterInput,
  PatternTesterRule,
  ToolContext,
  TrafficChecker,
  TrafficCompared,
} from './tools/common.js';
export type { ContractStatus } from './tools/contract.js';
// Read-side helpers the terminal needs for the same two levels the tools serve:
// what a type refers to (L2) and where a declaration ends (L3).
export { expandType } from './tools/types.js';
export { endOfDeclaration } from './tools/source.js';
// The chain an answer hands on (P63) and the same chain as Markdown (P67): pure,
// so a page can render the words the describe_for_prompt tool answers with.
export { hintsFor, nextFor, withNext, MAX_NEXT } from './query/next.js';
export type { Identified } from './query/next.js';
export { summariseProject, START_LIMITS } from './query/start.js';
export type { GapReason, ServiceCount, StartCounts, StartInput, StartLimits, StartSummary } from './query/start.js';
export { describeForPrompt, PROMPT_LIMITS } from './prompt/describe.js';
export type { PromptGap, PromptLimits, PromptStep, PromptSubject } from './prompt/describe.js';
export {
  fileIdOf,
  findingGapOf,
  gatherCheckSubject,
  gatherClassSubject,
  gatherFileSubject,
  gatherPromptSubject,
  gatherScopedSubject,
  gatherServiceSubject,
  promptFailuresSeen,
  PROMPT_SCOPES,
  rowsOfGap,
  scopesFor,
  serviceInputOf,
} from './prompt/gather.js';
export type { PromptScopeName, ScopeContext, ServiceCrossing, ServiceInput } from './prompt/gather.js';
export { checkSubjectAt, promptScopeContext } from './tools/prompt.js';
export { loadContractBreaks } from './query/contracts.js';
export { deadOptionsOf, deadRows, DEAD_KINDS } from './tools/dead.js';
export type { DeadKind } from './tools/dead.js';
export { findingsOf, FINDINGS_TOP, rankedFindingsOf } from './tools/findings.js';
export { usesOfType, TYPE_USE_GROUPS } from './tools/type-usage.js';
export { specOfNode, specsFor } from './tools/spec.js';
export type { Carries, EdgeUse, EntryUse, TypeUses } from './tools/type-usage.js';
export { CONTRACT_STATUS_RANK, crossingsBetween, crossingStatusOf } from './tools/contract.js';
export { runSearch, SEARCH_KINDS } from './tools/search.js';
export type { GapHit, SearchKind, TypeHit } from './tools/search.js';
export { diffState, readDiff, serviceInId, sideLabel, summariseChanges, verdictOf, VERDICTS } from './tools/changes.js';
export type {
  ChangedEntry,
  NewFinding,
  NewGap,
  RetestEntry,
  SideSaid,
  VanishedTarget,
  Verdict,
  VerdictOptions,
  VerdictWord,
  WhatChanged,
} from './tools/changes.js';
export { beforeRename, prReview, traceRoute, MAX_CROSSING_CHECKS, PROMPT_NAMES } from './prompts.js';
export type { PromptName } from './prompts.js';
export {
  reasonCatalogOf,
  serviceSummaryOf,
  REASONS_URI,
  SERVICES_URI,
  SERVICE_TEMPLATE,
  SERVICE_TOP_FINDINGS,
} from './resources.js';
export type { ReasonEntry, ReasonHint } from './resources.js';
export { startSummaryOf } from './tools/start.js';
export {
  blindSpotsAsRows,
  blindSpotsBeside,
  failuresSeen,
  figuresOf,
  loadObserved,
  loadObservedCounts,
  markObserved,
  nodeAmbiguous,
  nodeRow,
  nodeSeen,
  joinIdOf,
} from './query/observed.js';
export { failuresSeenRef, markFailsSeen } from './query/fails.js';
export type { FailRef, FailuresSeenRef } from './query/fails.js';
export type { ObservedCounts, TreeDirection } from './query/observed.js';
export { cantFollowFor } from './tools/cant-follow.js';
export type { CantFollowAnswer, CantFollowPlace } from './tools/cant-follow.js';
export {
  checkDocBlock,
  DOC_WALK,
  docsAbout,
  docsNow,
  docsPathFor,
  docSubjectOf,
  loadDocsIndex,
  recordedOf,
  resolveDocTarget,
  SEQUENCE_WALK_DETAIL,
  sitesFrom,
  staleDocsCount,
  stopsIn,
  withDocs,
} from './query/docs.js';
export type { DocAsk, DocCheck, DocRef, DocSubject, DocTarget } from './query/docs.js';
