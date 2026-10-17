import type { FailRef, FailuresSeenRef } from './fails.js';
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
  /** Set instead of everything else when a node is repeated: on its own path (a cycle), or anywhere in the walk (P92). */
  ref?: true;
  /**
   * On a repeat that is not a cycle: the id of the row the node's own row is
   * under, where its subtree is written (P92). A walk expands each node once.
   */
  seenAt?: string;
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
  /** Times real traffic went through this row, from the observed file (P72); absent when nothing saw it. */
  observed?: number;
  /** The 95th percentile of how long it took, in milliseconds, where the observed file measured it (P105). */
  p95?: number;
  /** Errors (the error flag or a 5xx) over the requests seen, where the file knows their outcome (P105). */
  errorRate?: number;
  /** Requests that could have been this row and were counted on nothing, fitting other places too (P85). */
  seenAmbiguous?: number;
  /**
   * On a row joined by a best guess (`edge.confidence: 'heuristic'`) that
   * traffic went through in the window (P110): the guess is confirmed. Read
   * beside the confidence, never written into it.
   */
  confirmedBy?: 'traffic';
  /** What a way in can fail with, on an entry that says (P68). */
  fails?: FailRef[];
  /** On a way in seen at run time: the statuses it answered that nothing declares, and the declared ones never seen (P106). */
  failures?: FailuresSeenRef;
  /** Decorators on the handler or its class that let a request past a check (P76). */
  optOuts?: OptOutRef[];
  /**
   * On a who_calls row (P94 D3): the top of a caller chain, a node that is no
   * way in and that nothing in the graph calls. Dead, or called from behind a
   * gap; `gapsInFile` counts the gaps in its file that might hide the call.
   */
  topOfChain?: true;
  gapsInFile?: number;
  /** On a who_calls row answering for a class (P95): the method of the class this caller calls. */
  calls?: string;
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

/** The limits a walk stops at (P92). */
export type WalkLimit = 'depth' | 'maxNodes' | 'maxChars';

/**
 * Why rows were left out: a walk names the limit and its value, and the tool
 * to ask on a row it did show (`get_flow` unless said); a list names the
 * offset its next page starts at (P93).
 */
export type Cut = { limit: WalkLimit; at: number; tool?: string } | { nextOffset: number };

/**
 * What a cut says, with the advice that helps for the limit that caused it
 * (P92): raising `depth` does nothing when `maxNodes` stopped the walk. A walk's
 * sentence always starts `n more nodes`, which is what the terminal reads back.
 */
export const truncationMessage = (count: number, exact: boolean, cut: Cut): Truncation => {
  const more = `${exact ? '' : '≥'}${count} more`;
  if ('nextOffset' in cut) return `${more}; next page offset ${cut.nextOffset}`;
  const ask = `ask ${cut.tool ?? 'get_flow'} on a child id`;
  switch (cut.limit) {
    case 'depth':
      return `${more} nodes past depth ${cut.at}; raise depth`;
    case 'maxNodes':
      return `${more} nodes past maxNodes ${cut.at}; raise maxNodes or ${ask}`;
    case 'maxChars':
      return `${more} nodes past about ${cut.at} characters; raise maxChars or ${ask}`;
  }
};
