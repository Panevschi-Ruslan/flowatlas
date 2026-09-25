import type {
  ClassIndex,
  ClassMethod,
  DiMap,
  ExtractContext,
  GraphNode,
  NamedFunction,
  TypeCollector,
  Unresolved,
} from '@flowatlas/core';

/**
 * As much of an entry point as a pass beside the extractor needs.
 *
 * An extractor's own record of an entry carries the route, the wrapping and the
 * class it was declared on; none of that is any of a channel reader's business.
 * What a channel reader wants is one question — is this handler already a way
 * in, and which node is it — so that is what is written down here.
 */
export interface EntryLike {
  readonly node: { readonly id: string };
  /** The method that answers, when the way in is a method. */
  readonly handlerMethod?: ClassMethod;
}

/**
 * What an extractor offers the walk over its bodies.
 *
 * Everything here is either the core's (`ExtractContext`) or a question about
 * this repository that only the extractor that indexed it can answer: which
 * classes it kept, which functions an entry point named, and what id and node a
 * body has. Nothing here is a framework, which is the point — the walk is the
 * same walk for any extractor that can answer these.
 */
export interface ScopeContext extends ExtractContext {
  /** Every class of this repository, with the role the extractor gave it. */
  readonly classes: ClassIndex;
  /**
   * Functions an entry point names, filled by the extractor's entries pass.
   *
   * A handler written in a registration is nobody's module-level function, so
   * without this the walk has no way to reach it.
   */
  readonly handlerFunctions: readonly NamedFunction[];

  /** Repo-relative POSIX path of whatever declared this node. */
  fileOf(node: { getSourceFile(): { getFilePath(): string } }): string;

  methodIdOf(declaration: ClassMethod): string | undefined;
  functionIdOf(fn: NamedFunction): string;

  ensureMethodNode(declaration: ClassMethod): GraphNode | undefined;
  ensureFunctionNode(fn: NamedFunction): GraphNode;
}

/**
 * What a pass written outside the extractor that hosts it is given.
 *
 * This is the whole of the inversion R46 asked for. A channel reader or a data
 * reader is not part of any extractor and must not be able to name one; what it
 * needs is the shape above plus injection, types, the entries already found and
 * somewhere to report what it could not read. Stating that shape here, in a
 * package neither extractor owns, is what lets both of them satisfy it without
 * either of them being named — and what stops a second extractor inheriting a
 * first one the day it wants to read a channel name.
 *
 * An extractor's own context satisfies this structurally, so there is nothing
 * to implement and nothing to register: the compiler checks the contract at the
 * one place a pass is handed a context.
 */
export interface PassContext extends ScopeContext {
  /** Constructor injection already resolved, for reading a receiver's origin. */
  readonly di: DiMap;
  /** The type registry being built. */
  readonly types: TypeCollector;
  /** Entry points found so far, so a handler can be joined to the way in. */
  readonly entries: readonly EntryLike[];

  report(row: Unresolved): void;
}
