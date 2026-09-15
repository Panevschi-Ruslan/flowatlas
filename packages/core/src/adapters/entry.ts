import type { EntryKind } from '../model/nodes.js';
import type { ExtractContext, PackageJson } from './context.js';

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
  detect(pkg: PackageJson): boolean;
  extractEntries(ctx: ExtractContext): EntryNode[];
}
