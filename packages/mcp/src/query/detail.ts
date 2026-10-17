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
/** The strings of a list kept on an edge, or none. */
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export const projectEdge = (edge: GraphEdge, level: DetailLevel): FlowEdge => {
  const projected: FlowEdge = { type: edge.type, confidence: edge.confidence };
  if (level <= 0) return projected;
  if (edge.params !== undefined && edge.params.length > 0) projected.params = [...edge.params];
  if (edge.returns !== undefined) projected.returns = edge.returns;
  const because = strings(edge.meta?.['because']);
  if (edge.confidence !== 'static' && because.length > 0) projected.because = because;
  const typedBy = edge.meta?.['typedBy'];
  if (typeof typedBy === 'string') projected.typedBy = typedBy;
  const notMatchedOn = strings(edge.meta?.['notMatchedOn']);
  if (notMatchedOn.length > 0) projected.notMatchedOn = notMatchedOn;
  const baseUrlFrom = edge.meta?.['baseUrlFrom'];
  if (typeof baseUrlFrom === 'string') projected.baseUrlFrom = baseUrlFrom;
  const baseUrl = edge.meta?.['baseUrl'];
  if (typeof baseUrl === 'string') projected.baseUrl = baseUrl;
  return projected;
};

export interface Truncated<T> {
  items: T[];
  /** How many there are in all, whatever page this is. */
  total: number;
  /** Set when rows are left after this page: how many, and where the next page starts. */
  truncated?: string;
  /** The `offset` that asks for the next page; absent on the last one. */
  nextOffset?: number;
}

/**
 * One page of a list: `maxNodes` rows from `offset`, and how to ask for the
 * rest (P93).
 *
 * The remedy for a cut used to be a larger `maxNodes`, which makes the answer
 * the size it was cut to avoid; a page keeps every answer the size asked for.
 * An offset past the end is an empty page that still says the total.
 */
export const truncate = <T>(items: readonly T[], maxNodes: number, offset = 0): Truncated<T> => {
  const start = Math.min(offset, items.length);
  const page = items.slice(start, start + maxNodes);
  const nextOffset = start + page.length;
  if (nextOffset >= items.length) return { items: page, total: items.length };
  return {
    items: page,
    total: items.length,
    truncated: truncationMessage(items.length - nextOffset, true, { nextOffset }),
    nextOffset,
  };
};
