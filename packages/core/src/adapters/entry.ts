import type { ApplicationMap } from './applications.js';
import type { FlowatlasConfig } from '../config.js';
import type { Confidence } from '../model/edges.js';
import type { EntryKind } from '../model/nodes.js';
import type { ExtractContext } from './context.js';
import type { EntryWrapping } from './wrapping.js';
import type { PackageJson } from './manifest.js';
import type { Envelope } from '../envelope.js';
import type { RequestReading } from '../request.js';
import type { StatedSignature } from '../types/signatures.js';

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
  /**
   * How far the `handles` edge onto the handler can be trusted, when that is
   * less than proven.
   *
   * Absent means `static`, which is what every reader that names its handler in
   * the registration itself means. A way in declared somewhere else, whose code
   * was found by searching for a module of the right name because nothing said
   * where it was packaged from, is the case that needs it: the edge is real if
   * the search found the only candidate, and it says so by being `heuristic`.
   */
  handlerConfidence?: Confidence;
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
  /**
   * The ways a message may be wrapped in what the handler is handed.
   *
   * Described rather than read, like the handler: the extractor reads, for each,
   * what the handler takes from that place - the declared type there, or what it
   * parses the text there into - and records it on the entry under
   * `meta.reads`, so a message delivered in any of these wrappings can be
   * compared with what the handler actually reads (R172).
   */
  reads?: readonly Envelope[];
  /**
   * Where a request's parts sit in what the handler is handed, and how it
   * answers, for a framework whose handler does not say so in its signature.
   *
   * Described rather than read, like `reads`: the extractor reads the handler
   * by it and records what it found on the `handles` edge, under the keys a
   * NestJS route's edge has always used, so every reader downstream sees one
   * shape of route whatever framework declared it (P29).
   */
  request?: RequestReading;
  /**
   * What a way in that is not a function takes and answers, where the adapter
   * found it in the declaration - a procedure's input schema and its resolver -
   * pointed at rather than collected: the extractor records it on the entry's
   * node as a function's node carries one (P35).
   */
  signature?: StatedSignature;
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
   *
   * `repoDir` is offered for the one kind of adapter whose evidence is neither
   * the manifest nor the configuration: ways in declared in files that describe
   * how the service is deployed. A repository of such files may have no manifest
   * at all, and one with a manifest need not name anything that gives it away,
   * so asking the manifest alone would switch the adapter off on exactly the
   * repositories it exists for. Offered and not promised, like the
   * configuration: a caller with no directory to hand passes none.
   */
  detect(pkg: PackageJson, config?: FlowatlasConfig, repoDir?: string): boolean;
  extractEntries(ctx: ExtractContext): EntryNode[];
  /**
   * Which applications this adapter reads in the service, for whoever has to
   * ask the question of something that is not an entry.
   *
   * Optional, and most adapters have nothing to say: a service with one address
   * space answers every such question the same way, and an adapter that cannot
   * tell one application from another should say nothing rather than invent a
   * map. Answering is what lets a reader that knows nothing about this
   * framework — the browser reader, recording which application a call site is
   * in — get the same answer the ids carry, from the same reading.
   */
  applications?(ctx: ExtractContext): ApplicationMap | undefined;
}
