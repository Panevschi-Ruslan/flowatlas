/** Payload shapes for the exchange. */

export interface OrderCreatedEvent {
  orderId: string;
  customerId: string;
  total: number;
}

export interface OrderCancelledEvent {
  orderId: string;
  reason: string;
}

export interface OrderRefundedEvent {
  orderId: string;
  amount: number;
}
