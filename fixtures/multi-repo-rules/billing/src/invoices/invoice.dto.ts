/**
 * Billing's own shapes.
 *
 * `OrderCreatedEvent` re-declares locally what `orders` sends as an
 * `@fx/contracts` `OrderDto`, which is deliberate: only `OrderDto` is shared, so
 * the payload type on the producer side and the payload type on the consumer
 * side are two different type ids and P10 has a real pair to compare later. The
 * linker itself only cares that the *channel* is the same.
 */
export interface OrderCreatedEvent {
  id: string;
  customerId: string;
  status: string;
  total: { amount: number; currency: string };
}

/** The payload of the channel nothing publishes. */
export interface InvoiceRequestedEvent {
  orderId: string;
  amount: number;
}

export interface CreateInvoiceDto {
  orderId: string;
  amount: number;
}

export interface InvoiceDto {
  id: string;
  orderId: string;
  amount: number;
  status: string;
}
