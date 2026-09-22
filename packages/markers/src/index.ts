/**
 * Annotations for the few places static analysis cannot reach.
 *
 * Every marker is a no-op at run time: it exists so that the extractor can read
 * it out of the source, and it must never change how the annotated code
 * behaves. That is also why this package has no dependencies at all and does
 * not use metadata reflection.
 *
 * Reach for a marker only where analysis is genuinely blind, such as a channel
 * name that comes from configuration or a target URL built at run time.
 * Annotating what can be derived produces documentation that rots.
 */

/** A decorator that does nothing, in either the standard or the legacy form. */
export type MarkerDecorator = (...args: unknown[]) => void;

const noop: MarkerDecorator = () => undefined;

export const MARKER_NAMES = [
  'Emits',
  'Consumes',
  'CallsService',
  'FlowEntry',
  'ContractIgnore',
] as const;

export type MarkerName = (typeof MARKER_NAMES)[number];

export const isMarkerName = (value: string): value is MarkerName =>
  (MARKER_NAMES as readonly string[]).includes(value);

/**
 * One name, several names, or a list of them.
 *
 * A project that keeps its channel names in one catalogue wants to reference
 * them by symbol and to name more than one at a time; both forms mean the same
 * thing as a stack of single annotations, and a stack of six is six lines
 * saying one thing.
 */
export type Names = ReadonlyArray<string | readonly string[]>;

/**
 * This method publishes to these channels.
 *
 * For a channel name the analyser cannot follow, typically one read from
 * configuration. `@Emits('a')`, `@Emits('a', 'b')`, `@Emits(['a', 'b'])` and a
 * stack of single annotations all mean the same thing.
 */
export const Emits = (...channels: Names): MarkerDecorator => noop;

/** This method receives from these channels, written the same ways. */
export const Consumes = (...channels: Names): MarkerDecorator => noop;

/**
 * This method calls another service.
 *
 * `routes` are the method and path of each target, e.g. `POST /invoices`, one
 * argument each or as a list. For URLs assembled at run time.
 */
export const CallsService = (service: string, ...routes: Names): MarkerDecorator => noop;

/**
 * Names the flow this entry point starts, for reporting.
 *
 * One name, deliberately: an entry point is where one flow begins, and a
 * handler that began two flows would be two entry points. The list form the
 * channel markers take would be saying something this marker does not mean.
 */
export const FlowEntry = (name: string): MarkerDecorator => noop;

/** Contract drift here is intentional; report it, do not fail on it. */
export const ContractIgnore = (): MarkerDecorator => noop;
