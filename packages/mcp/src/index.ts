/**
 * The map, offered to an agent.
 *
 * Everything before this built a graph nobody read. These tools are how a
 * session in one repository answers a question about another one without
 * opening it.
 */
export { createFlowatlasServer, startStdioServer, SERVER_NAME } from './server.js';
export type { ServerOptions } from './server.js';
export { DbHandle } from './query/db.js';
export type { DbHandleOptions, SourceRoots } from './query/db.js';
export { resolveEntryRef, isResolved } from './query/entry-ref.js';
export type { EntryRef } from './query/entry-ref.js';
export { buildFlowTree, flatten, FORWARD_EDGES, REVERSE_EDGES } from './query/flow.js';
export type { FlowOptions, FlowResult } from './query/flow.js';
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
} from './query/types.js';
export type { ContractChecker, ContractFinding, ToolContext } from './tools/common.js';
export type { ContractStatus } from './tools/contract.js';
// Read-side helpers the terminal needs for the same two levels the tools serve:
// what a type refers to (L2) and where a declaration ends (L3).
export { expandType } from './tools/types.js';
export { endOfDeclaration } from './tools/source.js';
