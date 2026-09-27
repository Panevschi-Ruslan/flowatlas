import type { FlowatlasConfig } from '../config.js';
import type { EntryKind } from '../model/nodes.js';
import type { ExtractContext } from './context.js';
import type { EntryWrapping } from './wrapping.js';
import type { PackageJson } from './manifest.js';

/** A method of a class, which is where most handlers live. */
export interface MethodHandler {
  /** Repo-relative POSIX path. */
  file: string;
  className: string;
  methodName: string;
  line?: number;
}

/**
 * A function declared at the top of a module.
 *
 * A project that keeps its handlers in a table of `key -> function` has no class
 * between the way in and the work it does, and the function is still the code
 * that runs.
 */
export interface FunctionHandler {
  /** Repo-relative POSIX path. */
  file: string;
  functionName: string;
  line?: number;
}

/**
 * A function written in the registration itself, found again by where it starts.
 *
 * `app.get('/health', (c) => …)` and `register('key', (ctx) => …)` hold the code
 * that runs, with no name anywhere to point at. Its position is the one thing
 * that names it, so the position is what is carried, with a label for a reader.
 */
export interface InlineHandler {
  /** Repo-relative POSIX path. */
  file: string;
  /** Where the function starts, 1-based, as the editor counts. */
  line: number;
  column: number;
  /** How a reader knows it: the registration it was written in. */
  label: string;
  inline: true;
}

/** Where the code that answers an entry point lives. */
export type EntryHandler = MethodHandler | FunctionHandler | InlineHandler;

export const isFunctionHandler = (handler: EntryHandler): handler is FunctionHandler =>
  'functionName' in handler;

export const isInlineHandler = (handler: EntryHandler): handler is InlineHandler =>
  'inline' in handler && handler.inline === true;

/**
 * One entry point, as reported by an adapter.
 *
 * An adapter describes what it found and stops there: turning this into a node
 * plus the edge to the handler is the extractor's job, so no adapter has to
 * reimplement that bookkeeping.
 */
export interface EntryNode {
  /** Built with `makeEntryId`. */
  id: string;
  kind: EntryKind;
  label: string;
  /** The kind-specific half of the id, e.g. `POST:/orders/:param`. */
  key: string;
  /**
   * Where the code behind it lives, when the adapter could name it.
   *
   * Absent when a registration passes a function written in place: the way in is
   * real either way and is worth a node, and the adapter records a row saying
   * why nothing can be pointed at.
   */
  handler?: EntryHandler;
  /** Repo-relative POSIX path of the declaration site. */
  file: string;
  line?: number;
  /**
   * What runs in front of it, in the order it runs.
   *
   * Described rather than drawn, like the handler: the extractor turns it into
   * the same nodes and the same `guarded_by` edges a decorator-driven reader
   * produces, so that a route's protection is one shape in the graph however it
   * was written. A list on the entry was the other option and is why nothing
   * that read the graph as a graph could see a middleware chain at all (R109).
   */
  wrapping?: readonly EntryWrapping[];
  meta?: Record<string, unknown>;
}

export interface EntryAdapter {
  name: string;
  /**
   * Whether its entry points are answered outside the application the
   * extractor reads: a worker routing requests before the application sees
   * them, or a bot library dispatching updates itself. The application's own
   * guards, pipes and middleware never run for those, so none are drawn.
   */
  outsideApplication?: boolean;
  /**
   * Whether this adapter applies to a repository.
   *
   * The manifest answers it for an adapter that stands for a package: the
   * dependency is there or it is not. It cannot answer it for an adapter that
   * runs descriptions the project wrote, because what such an adapter
   * recognises is in the configuration rather than in the repository, so the
   * configuration is offered alongside it.
   *
   * Offered rather than promised: a caller that has no configuration to hand
   * passes none, and an adapter that reads the manifest alone declares one
   * parameter and is none the wiser. Only this slot is given it, because only
   * here does a description decide whether an adapter runs at all: the broker
   * and data-layer descriptions are read by passes that go looking for them
   * whatever was detected, so nothing about them is waiting on this answer.
   */
  detect(pkg: PackageJson, config?: FlowatlasConfig): boolean;
  extractEntries(ctx: ExtractContext): EntryNode[];
}
