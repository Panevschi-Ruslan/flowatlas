/** Payload and return shapes. One type per channel, so the `emits` edges and the
 *  `handles` edge of the rpc consumer point at distinguishable ids. */

export interface OrderCreatedEvent {
  orderId: string;
  customerId: string;
  total: number;
}

export interface OrderPaidEvent {
  orderId: string;
  paidAt: string;
}

export interface OrderShippedEvent {
  orderId: string;
  carrier: string;
}

export interface OrderArchivedEvent {
  orderId: string;
}

export interface OrderQuery {
  orderId: string;
}

export interface Order {
  id: string;
  customerId: string;
  status: 'created' | 'paid' | 'shipped';
  total: number;
}
