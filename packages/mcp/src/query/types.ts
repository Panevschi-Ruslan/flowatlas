import type { DetailLevel } from '@flowatlas/core';

/**
 * A node as it goes over the wire.
 *
 * The server exists to save the reader's attention, so a node says who it is
 * and where it lives and stops there. Anything larger is asked for by name.
 */
export interface CompactNode {
  id: string;
  type: string;
  label: string;
  /** `file:line`, from L1. */
  loc?: string;
  service?: string;
  kind?: string;
  /** From L2. */
  meta?: Record<string, unknown>;
  /** Set instead of everything else when a node is repeated on the same path. */
  ref?: true;
}

/** How one node was reached. */
export interface FlowEdge {
  type: string;
  confidence: string;
  /** Type ids the call carries, from L1. */
  params?: string[];
  returns?: string;
  /**
   * Why an edge less than proven was drawn at all, from L1: a channel matched
   * by a prefix, a part not filtered (P23). An edge that is weak and says
   * nothing about it leaves a reader to guess which part to doubt.
   */
  because?: string[];
  /** Filters the join recorded and did not match on, from L1. */
  notMatchedOn?: string[];
}

/** Something that runs before an entry, in the order it runs. */
export interface GuardRef {
  id: string;
  label: string;
  kind: string;
  order: number;
}

export interface FlowNode {
  node: CompactNode;
  edge?: FlowEdge;
  guards?: GuardRef[];
  children: FlowNode[];
}

/** Present only when something was left out, and it always says how much. */
export type Truncation = string;

export interface ToolResult<T> {
  result?: T;
  truncated?: Truncation;
  note?: string;
  error?: string;
}

export interface CommonInput {
  detail: DetailLevel;
  maxNodes: number;
}

export const truncationMessage = (count: number, exact: boolean): Truncation =>
  `${exact ? '' : '≥'}${count} more nodes, increase depth or narrow scope`;
