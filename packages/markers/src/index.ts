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
 * This method publishes to `channel`.
 *
 * For a channel name the analyser cannot follow, typically one read from
 * configuration.
 */
export const Emits = (channel: string): MarkerDecorator => noop;

/** This method receives from `channel`. */
export const Consumes = (channel: string): MarkerDecorator => noop;

/**
 * This method calls another service.
 *
 * `route` is the method and path of the target, e.g. `POST /invoices`. For URLs
 * assembled at run time.
 */
export const CallsService = (service: string, route: string): MarkerDecorator => noop;

/** Names the flow this entry point starts, for reporting. */
export const FlowEntry = (name: string): MarkerDecorator => noop;

/** Contract drift here is intentional; report it, do not fail on it. */
export const ContractIgnore = (): MarkerDecorator => noop;
