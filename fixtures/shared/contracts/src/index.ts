// Wire contracts shared between fixture repos.
//
// Types declared here must be registered under a package-scoped id
// (`type:@fixture/contracts#<Name>`, P02 §4 / D7) in every repo that lists
// `@fixture/contracts` in `sharedPackages`, with an equal `structuralHash`.

/** Nested type, exported so it gets its own package-scoped entry. */
export interface SharedMoney {
  amount: number;
  currency: string;
}

/** String-literal union alias shared across repos. */
export type SharedOrderStatus = 'created' | 'paid' | 'cancelled';

/** The event published by one repo and consumed by another. */
export interface SharedOrderEvent {
  orderId: string;
  customerId: string;
  status: SharedOrderStatus;
  total: SharedMoney;
  occurredAt: string;
}
