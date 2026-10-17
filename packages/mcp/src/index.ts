/**
 * The map, offered to an agent.
 *
 * Everything before this built a graph nobody read. These tools are how a
 * session in one repository answers a question about another one without
 * opening it.
 */
export { createFlowatlasServer, startStdioServer, SERVER_NAME, INSTRUCTIONS } from './server.js';
export type { ServerOptions } from './server.js';
export { DbHandle } from './query/db.js';
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
  gatherCheckSubject,
  gatherClassSubject,
  gatherFileSubject,
  gatherPromptSubject,
  gatherScopedSubject,
  gatherServiceSubject,
  PROMPT_SCOPES,
  rowsOfGap,
  scopesFor,
} from './prompt/gather.js';
export type { PromptScopeName, ScopeContext, ServiceCrossing } from './prompt/gather.js';
export { deadOptionsOf, deadRows, DEAD_KINDS } from './tools/dead.js';
export type { DeadKind } from './tools/dead.js';
export { findingsOf, FINDINGS_TOP } from './tools/findings.js';
export { usesOfType, TYPE_USE_GROUPS } from './tools/type-usage.js';
export type { Carries, EdgeUse, EntryUse, TypeUses } from './tools/type-usage.js';
export { crossingsBetween } from './tools/contract.js';
export { runSearch, SEARCH_KINDS } from './tools/search.js';
export type { GapHit, SearchKind, TypeHit } from './tools/search.js';
export { summariseChanges, readDiff } from './tools/changes.js';
export type { ChangedEntry, WhatChanged } from './tools/changes.js';
export { loadObservedCounts, markObserved, nodeAmbiguous, nodeSeen, joinIdOf } from './query/observed.js';
export type { ObservedCounts, TreeDirection } from './query/observed.js';
export { cantFollowFor } from './tools/cant-follow.js';
export type { CantFollowAnswer, CantFollowPlace } from './tools/cant-follow.js';
