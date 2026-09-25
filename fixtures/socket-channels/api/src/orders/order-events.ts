/** What travels on the order channels, and the states an order moves through. */

export interface OrderUpdate {
  orderId: string;
  total: number;
  state: OrderState;
}

export interface CancelOrder {
  orderId: string;
  reason: string;
}

export interface OrderSummary {
  orderId: string;
  lines: number;
  total: number;
}

/**
 * A closed set, which is the whole point of it.
 *
 * The lifecycle event name is built from one of these, so the reader can work
 * out every channel that publish reaches instead of leaving a hole in the name.
 */
export type OrderState = 'ORDER_OPENED' | 'ORDER_CLOSED';
