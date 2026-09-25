/**
 * What the browser believes travels on the order channels.
 *
 * Declared here and again in `api`, because the two repositories share no
 * package. That the two declarations agree is a claim nothing in either checks,
 * which is the sort of thing the graph is for.
 */

export interface OrderUpdate {
  orderId: string;
  total: number;
  state: string;
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
