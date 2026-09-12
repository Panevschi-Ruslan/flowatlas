// Channel names shared between fixture repos.
//
// This package exists for step 2 of the channel-name resolver (P04 §10, row 3):
// `client.emit(EVENTS.orderShipped, dto)` in a repo that lists
// `@fixture/events` in `sharedPackages` must be followed through the import
// into the declaration below and come out as the literal `order.shipped`, with
// `meta.channelVia: "shared-package"`.
//
// That only works while the literal survives the declaration, which is why the
// object carries `as const` and the second form is a string enum. `LEGACY_TOPIC`
// is the counter-example the troubleshooting table names (§13): a value widened
// to `string` has no literal left to read.

/** `as const` keeps every value a string literal type rather than `string`. */
export const EVENTS = {
  orderShipped: 'order.shipped',
  orderRefunded: 'order.refunded',
} as const;

/** The other declaration form whose members keep their literal: a string enum. */
export enum SharedTopics {
  OrderArchived = 'order.archived',
}

/**
 * Deliberately annotated `: string`, which throws the literal away. A repo that
 * emits on this constant cannot have its channel resolved.
 * Expected: unresolved `channel-const-unresolved`.
 */
export const LEGACY_TOPIC: string = 'order.legacy';
