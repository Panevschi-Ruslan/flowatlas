// Wire contracts shared between the repositories of this project.
//
// `gateway` and `orders` both import `OrderDto` from here, which is the case
// P05 D6 exists for: a type whose declaration resolves under a `sharedPackages`
// entry is merged across repositories by (package, name) into one registry
// entry, `type:@fx/contracts#OrderDto`, and every edge that referenced a
// per-repo copy is rewritten to point at it (§12).
//
// This directory is the source of truth, but nothing resolves to it: the fixture
// must type-check without an install, so each importing repository carries a
// byte-identical declaration copy at `<repo>/node_modules/@fx/contracts`. Edit
// this file and you must re-copy both — see the header of either copy.

/** The status of an order, as it goes over the wire. */
export type OrderStatus = 'created' | 'paid' | 'cancelled';

/** Nested on purpose, so the merged type has a field that is itself a type id. */
export interface Money {
  amount: number;
  currency: string;
}

/** The shape `orders` returns and `gateway` asks for. */
export interface OrderDto {
  id: string;
  customerId: string;
  status: OrderStatus;
  total: Money;
}

/** The body of `POST /orders`. */
export interface CreateOrderDto {
  customerId: string;
  total: Money;
}
