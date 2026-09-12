/**
 * Billing's own reading of what `orders` publishes.
 *
 * It drifted: `orders` sends `customerId` and this expects `customerRef`. There
 * is no compiler anywhere on the path between a publisher in one repository and
 * a handler in another, which is the whole reason the check exists.
 *
 * The head revision does not fix it. It annotates it, which is the honest thing
 * to do about drift somebody has decided to live with.
 */
export interface OrderCreatedEvent {
  orderId: string;
  customerRef: string;
}

/** What billing sends when a checked-out cart has to become an order. */
export interface CreateOrderDto {
  customerId: string;
  note: string;
}
