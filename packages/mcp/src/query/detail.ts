import type { DetailLevel, GraphEdge, GraphNode } from '@flowatlas/core';
import type { CompactNode, FlowEdge } from './types.js';
import { truncationMessage } from './types.js';

/**
 * The most a tool other than `get_source` will say.
 *
 * Level 3 means source code, and a tree asked for at level 3 would pull the
 * body of every method in it. Code is fetched one symbol at a time, on purpose.
 */
export const MAX_DETAIL: DetailLevel = 2;

export const CLAMP_NOTE = 'detail clamped to 2; use get_source';

/** Level 3 is not refused, it is answered at 2 and said so. */
export const clampDetail = (level: DetailLevel): DetailLevel =>
  level > MAX_DETAIL ? MAX_DETAIL : level;

/**
 * Cuts a node down to the level asked for.
 *
 * Each level is a superset of the one below: an identity, then where to find
 * it, then what it knows about itself.
 */
export const projectDetail = (node: GraphNode, level: DetailLevel): CompactNode => {
  const compact: CompactNode = { id: node.id, type: node.type, label: node.label };
  if (level <= 0) return compact;

  if (node.file !== undefined) {
    compact.loc = node.line === undefined ? node.file : `${node.file}:${node.line}`;
  }
  if (node.repo !== '') compact.service = node.repo;
  if (node.kind !== undefined) compact.kind = node.kind;
  if (level <= 1) return compact;

  if (node.meta !== undefined && Object.keys(node.meta).length > 0) compact.meta = node.meta;
  return compact;
};

/** The same, for the edge that led to a node. Confidence is never dropped. */
export const projectEdge = (edge: GraphEdge, level: DetailLevel): FlowEdge => {
  const projected: FlowEdge = { type: edge.type, confidence: edge.confidence };
  if (level <= 0) return projected;
  if (edge.params !== undefined && edge.params.length > 0) projected.params = [...edge.params];
  if (edge.returns !== undefined) projected.returns = edge.returns;
  return projected;
};

export interface Truncated<T> {
  items: T[];
  truncated?: string;
}

/** Keeps the first `maxNodes` and says exactly how many were left. */
export const truncate = <T>(items: readonly T[], maxNodes: number): Truncated<T> => {
  if (items.length <= maxNodes) return { items: [...items] };
  return {
    items: items.slice(0, maxNodes),
    truncated: truncationMessage(items.length - maxNodes, true),
  };
};
