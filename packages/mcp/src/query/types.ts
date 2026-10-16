import type { FailRef } from './fails.js';
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
  /**
   * The package whose types the edge was drawn through, when a stand-in read
   * in place of an install supplied them (P78): its source in a repository
   * read here (`because: ["package-from-repo"]`) or a shape file of the
   * project's own (`["shape-file"]`). From L1.
   */
  typedBy?: string;
  /** Filters the join recorded and did not match on, from L1. */
  notMatchedOn?: string[];
  /**
   * Where the base address a request was joined by came from, from L1: the
   * file that gives its setting the value, `its name`, or the deployment
   * (P77). Absent where the configuration named the service.
   */
  baseUrlFrom?: string;
  /** The value itself, cut to scheme, host and path, from L1. */
  baseUrl?: string;
}

/** Something that runs before an entry, in the order it runs. */
export interface GuardRef {
  id: string;
  label: string;
  kind: string;
  order: number;
  /**
   * Where it was attached (P76): `global`, `module`, `controller` or `route`,
   * and how, in words (`APP_GUARD in AuthModule`). Present where the reader
   * of the framework said.
   */
  where?: string;
  via?: string;
  /** The decorator on the handler or its class that switches this check off for it. */
  skippedBy?: string;
}

/** A decorator on a handler or its class that lets a request past a check (P76). */
export interface OptOutRef {
  decorator: string;
  key?: string;
  /** The decorator says the route is open on purpose. */
  public: boolean;
  /** The checks in front of the route that read its flag. */
  skips: string[];
  where: 'controller' | 'route';
  loc?: string;
}

export interface FlowNode {
  node: CompactNode;
  edge?: FlowEdge;
  guards?: GuardRef[];
  /** Times real traffic went through this row, from `observed.json` (P72); absent when nothing saw it. */
  observed?: number;
  /** What a way in can fail with, on an entry that says (P68). */
  fails?: FailRef[];
  /** Decorators on the handler or its class that let a request past a check (P76). */
  optOuts?: OptOutRef[];
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
