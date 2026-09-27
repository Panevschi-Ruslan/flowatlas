// Channel names shared between fixture repos.
//
// This package exists for step 2 of the channel-name resolver (P04 §10, row 3):
// `client.emit(EVENTS.orderShipped, dto)` in a repo that lists
// `@fixture/events` in `sharedPackages` must be followed through the import
// into the declaration below and come out as the literal `order.shipped`, with
// `meta.channelVia: "shared-package"`.
//
// Read from a package's `.d.ts` only the type is left, which is why the object
// carries `as const` and the second form is a string enum. `LEGACY_TOPIC` is the
// case §13 worried about, and read from source it resolves: `: string` widens
// the type, not the value, and a `const` holds only what it was written (R140).

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
 * Deliberately annotated `: string`, which widens the type and not the value:
 * the binding is a `const`, so every emit on it sends `order.legacy`.
 * Expected: `channel:order.legacy` (R140; this used to say the opposite).
 */
export const LEGACY_TOPIC: string = 'order.legacy';
